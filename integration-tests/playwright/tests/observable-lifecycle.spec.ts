import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * End-to-end smoke test against a real Yeti stack (real ArangoDB, real API,
 * no mocked routes): create a hostname observable through the UI, confirm it
 * persisted by searching for it, tag it, then delete it and confirm it's
 * gone. Exercises the real /observables POST, GET, /tag, DELETE, and /search
 * endpoints end to end, unlike the frontend's own mocked e2e suite.
 */
test("create, search, tag, and delete an observable", async ({ page }) => {
  const hostname = `integration-test-${Date.now()}.example.com`;

  await login(page);

  // --- Create ---
  await page.goto("/observables");
  await page.getByRole("button", { name: "New Observable" }).click();
  await page.getByRole("listitem").filter({ hasText: "Hostname" }).first().click();

  // getByRole("dialog") (not .v-overlay--active) -- against a real backend a
  // save/create snackbar is genuinely visible and also carries
  // v-overlay--active, making that class ambiguous.
  const newDialog = page.getByRole("dialog");
  await expect(newDialog.getByText("New Hostname")).toBeVisible();
  await newDialog.getByLabel("Value").fill(hostname);
  await newDialog.getByRole("button", { name: "Save" }).click();

  // On success, NewObject redirects to the created object's details page.
  await expect(page).toHaveURL(/\/observables\/[\w-]+$/);
  await expect(page.locator(".observable-value")).toHaveText(hostname);
  const observableId = new URL(page.url()).pathname.split("/").pop();

  // --- Tag ---
  const tagBox = page.locator(".v-combobox input").first();
  await tagBox.fill("integration-test-tag");
  await tagBox.press("Enter");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("integration-test-tag")).toBeVisible();

  // --- Search ---
  // ArangoSearch views are eventually consistent (same reason the backend's
  // own test suite waits after tagging before searching) -- retry the search
  // itself, not just the assertion, until the view has caught up.
  await page.goto("/observables");
  const searchInput = page.getByRole("textbox", { name: /Search observables/ });
  await expect(async () => {
    await searchInput.fill(hostname);
    await searchInput.press("Enter");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr").first()).toContainText("integration-test-tag");
  }).toPass({ timeout: 10_000 });
  await expect(page.locator("tbody tr").first()).toContainText(hostname);

  // --- Delete ---
  await page.locator("tbody tr").first().getByRole("link", { name: hostname }).click();
  await expect(page).toHaveURL(/\/observables\/[\w-]+$/);
  await page.getByRole("button", { name: "Edit" }).click();

  const editDialog = page.getByRole("dialog");
  await editDialog.getByRole("button", { name: "Delete object" }).click();

  const confirmDialog = page.getByRole("dialog").last();
  await expect(confirmDialog.getByText("Are you sure you want to delete this item?")).toBeVisible();
  // Wait for the actual DELETE to land before checking below -- a bare
  // .click() only waits for the click event to dispatch, not for the
  // resulting request/response, so the immediate follow-up GET can race
  // ahead of it under load: fine on a quiet run, but flips consistently
  // once enough other specs have run before it in the same worker.
  const deleteResponse = page.waitForResponse(
    res => res.url().includes(`/observables/${observableId}`) && res.request().method() === "DELETE"
  );
  await confirmDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await deleteResponse;

  // --- Confirm gone ---
  // Query the API directly rather than the search view: tagging appears to
  // push the view's eventual-consistency window out well past what's
  // reasonable to poll for in a smoke test (observed >15s in practice, vs
  // ~1-2s for an untagged object), even though the underlying document is
  // deleted immediately -- a direct GET reflects that right away.
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  const response = await page.request.get(`/api/v2/observables/${observableId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  expect(response.status()).toBe(404);
});
