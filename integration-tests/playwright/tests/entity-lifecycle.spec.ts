import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Same shape as observable-lifecycle.spec.ts, for the entity family: create a
 * Malware entity through the UI, confirm it persisted by searching for it,
 * tag it, then delete it and confirm it's gone. Exercises the real
 * /entities POST, GET, /tag, DELETE, and /search endpoints end to end.
 */
test("create, search, tag, and delete an entity", async ({ page }) => {
  const name = `integration-test-malware-${Date.now()}`;

  await login(page);

  // --- Create ---
  await page.goto("/entities");
  await page.getByRole("button", { name: "New Entity" }).click();
  await page.getByRole("listitem").filter({ hasText: "Malware" }).first().click();

  const newDialog = page.getByRole("dialog");
  await expect(newDialog.getByText("New Malware")).toBeVisible();
  await newDialog.getByLabel("Name").fill(name);
  await newDialog.getByRole("button", { name: "Save" }).click();

  // On success, NewObject redirects to the created object's details page.
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await expect(page.locator(".yeti-object-title code")).toHaveText(name);
  const entityId = new URL(page.url()).pathname.split("/").pop();

  // --- Tag ---
  const tagBox = page.locator(".v-combobox input").first();
  await tagBox.fill("integration-test-tag");
  await tagBox.press("Enter");
  // Wait for the actual tag POST to land, not just the chip's (purely local,
  // pre-save) appearance in the combobox -- navigating away (below) too soon
  // after clicking Save can cancel the still-in-flight request.
  const tagResponse = page.waitForResponse(res => res.url().includes("/entities/tag") && res.request().method() === "POST");
  await page.getByRole("button", { name: "Save" }).click();
  await tagResponse;
  await expect(page.getByText("integration-test-tag")).toBeVisible();

  // --- Search ---
  // ArangoSearch views are eventually consistent -- retry the search itself,
  // not just the assertion, until the view has caught up (see
  // observable-lifecycle.spec.ts for the same pattern and more detail).
  //
  // Entities/indicators render one table per type tab, all mounted "eager"
  // (hidden, not destroyed) at once -- an empty table still renders a
  // "no data" placeholder row, so a bare "tbody tr" locator picks up rows
  // from every hidden tab's table too. Scope to :visible rows (the active
  // tab's table only).
  await page.goto("/entities");
  const searchInput = page.getByRole("textbox", { name: /Search entities/ });
  const visibleRows = page.locator("tbody tr:visible");
  await expect(async () => {
    // clear() then fill() -- unlike Observables' search box (which calls
    // loadObjects() directly on Enter), this one only re-queries when the
    // underlying Vue ref's *value* actually changes on keyup.enter. Refilling
    // the same string on every retry is a no-op the ref reactivity silently
    // drops, so the search would only ever fire once no matter how long the
    // retry loop waited.
    await searchInput.clear();
    await searchInput.press("Enter");
    await searchInput.fill(name);
    await searchInput.press("Enter");
    await expect(visibleRows).toHaveCount(1);
    await expect(visibleRows.first()).toContainText("integration-test-tag");
  }).toPass({ timeout: 20_000 });
  await expect(visibleRows.first()).toContainText(name);

  // --- Delete ---
  await visibleRows.first().getByRole("link", { name }).click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await page.getByRole("button", { name: "Edit" }).click();

  const editDialog = page.getByRole("dialog");
  await editDialog.getByRole("button", { name: "Delete object" }).click();

  const confirmDialog = page.getByRole("dialog").last();
  await expect(confirmDialog.getByText("Are you sure you want to delete this item?")).toBeVisible();
  // Wait for the actual DELETE to land before checking below -- a bare
  // .click() only waits for the click event to dispatch, not for the
  // resulting request/response, so the immediate follow-up GET can race
  // ahead of it under load (see observable-lifecycle.spec.ts for the same
  // fix and more detail).
  const deleteResponse = page.waitForResponse(
    res => res.url().includes(`/entities/${entityId}`) && res.request().method() === "DELETE"
  );
  await confirmDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await deleteResponse;

  // --- Confirm gone ---
  // Direct API GET, not the search view -- deleting a tagged object pushes
  // the view's eventual-consistency window out well past what's reasonable
  // to poll for in a smoke test (see observable-lifecycle.spec.ts).
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  const response = await page.request.get(`/api/v2/entities/${entityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  expect(response.status()).toBe(404);
});
