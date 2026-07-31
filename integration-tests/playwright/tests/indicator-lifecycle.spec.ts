import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Same shape as observable-lifecycle.spec.ts, for the indicator family:
 * create a Regex indicator through the UI, confirm it persisted by searching
 * for it, tag it, then delete it and confirm it's gone. Exercises the real
 * /indicators POST, GET, /tag, DELETE, and /search endpoints end to end.
 *
 * Regex is the simplest indicator type with a required non-name field
 * (pattern, validated server-side as a compilable regex) and a required
 * select field (diamond model, no default -- must be picked explicitly).
 */
test("create, search, tag, and delete an indicator", async ({ page }) => {
  const name = `integration-test-regex-${Date.now()}`;

  await login(page);

  // --- Create ---
  await page.goto("/indicators");
  await page.getByRole("button", { name: "New Indicator" }).click();
  await page.getByRole("listitem").filter({ hasText: "Regular expression" }).first().click();

  const newDialog = page.getByRole("dialog");
  await expect(newDialog.getByText("New Regular expression")).toBeVisible();
  await newDialog.getByLabel("Name").fill(name);
  await newDialog.getByLabel("Pattern").fill("integration-test-\\d+");
  // Keyboard, not click -- the parent "New Indicator" menu never actually
  // closes once a type dialog opens (a real, minor UI quirk: both overlays
  // stay active, stacked), so a click at the v-select's computed coordinates
  // is unreliable (it can land on the stale menu layer instead of opening
  // the dropdown). Focusing + arrow-down + selecting the option by role
  // avoids the pointer path entirely.
  const diamondInput = newDialog.getByLabel("Diamond model");
  await diamondInput.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: "victim" }).click();
  await newDialog.getByRole("button", { name: "Save" }).click();

  // On success, NewObject redirects to the created object's details page.
  await expect(page).toHaveURL(/\/indicators\/[\w-]+$/);
  await expect(page.locator(".yeti-object-title code")).toHaveText(name);
  const indicatorId = new URL(page.url()).pathname.split("/").pop();

  // --- Tag ---
  const tagBox = page.locator(".v-combobox input").first();
  await tagBox.fill("integration-test-tag");
  await tagBox.press("Enter");
  // Wait for the actual tag POST to land, not just the chip's (purely local,
  // pre-save) appearance in the combobox -- navigating away (below) too soon
  // after clicking Save can cancel the still-in-flight request.
  const tagResponse = page.waitForResponse(res => res.url().includes("/indicators/tag") && res.request().method() === "POST");
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
  await page.goto("/indicators");
  const searchInput = page.getByRole("textbox", { name: /Search indicators/ });
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
  await expect(page).toHaveURL(/\/indicators\/[\w-]+$/);
  await page.getByRole("button", { name: "Edit" }).click();

  const editDialog = page.getByRole("dialog");
  await editDialog.getByRole("button", { name: "Delete object" }).click();

  const confirmDialog = page.getByRole("dialog").last();
  await expect(confirmDialog.getByText("Are you sure you want to delete this item?")).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Delete", exact: true }).click();

  // --- Confirm gone ---
  // Direct API GET, not the search view -- deleting a tagged object pushes
  // the view's eventual-consistency window out well past what's reasonable
  // to poll for in a smoke test (see observable-lifecycle.spec.ts).
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  const response = await page.request.get(`/api/v2/indicators/${indicatorId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  expect(response.status()).toBe(404);
});
