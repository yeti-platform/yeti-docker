import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Creates a DFIQ Scenario through the top-level "New DFIQ object" flow
 * (EditDFIQObject.vue, not the generic NewObject.vue) and confirms it
 * persisted. Exercises the real /dfiq/validate and /dfiq/from_yaml
 * endpoints end to end.
 */
test("create a DFIQ scenario", async ({ page }) => {
  const scenarioName = `integration-test-scenario-${Date.now()}`;

  await login(page);

  await page.goto("/dfiq");
  await page.getByRole("button", { name: "New DFIQ object" }).click();
  await page.getByRole("listitem").filter({ hasText: "Scenario" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Creating DFIQ scenario")).toBeVisible();
  await dialog.getByLabel("Name").fill(scenarioName);

  // The form doesn't save the entered fields directly -- they flow into an
  // in-memory YAML document that's re-validated against /api/v2/dfiq/validate
  // on a 500ms debounce, and Save stays disabled until that comes back valid.
  await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/\/dfiq\/[\w-]+$/);
  const scenarioId = new URL(page.url()).pathname.split("/").pop();
  await expect(page.locator(".yeti-object-title code")).toHaveText(scenarioName);

  // --- Confirm gone after delete ---
  await page.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog");
  await expect(editDialog.getByText("Editing DFIQ scenario")).toBeVisible();
  await editDialog.getByRole("button", { name: "Delete object" }).click();
  const confirmDialog = page.getByRole("dialog").last();
  await expect(confirmDialog.getByText("Are you sure you want to delete this item?")).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Delete", exact: true }).click();

  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  const response = await page.request.get(`/api/v2/dfiq/${scenarioId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  expect(response.status()).toBe(404);
});
