import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Creates a Malware entity and a Regex indicator, links them from the
 * entity's details page (LinkObject.vue), then confirms the link shows up
 * in the neighbors table ("Related X" tabs, backed by DirectNeighbors.vue)
 * on *both* objects' details pages. Exercises the real /entities POST,
 * /indicators POST, /graph/ POST (link creation), and /graph/search (the
 * neighbors table's own query) endpoints end to end.
 */
test("link an entity and an indicator, and confirm they appear in each other's neighbors table", async ({
  page
}) => {
  const entityName = `integration-test-malware-${Date.now()}`;
  const indicatorName = `integration-test-regex-${Date.now()}`;

  await login(page);

  // --- Create the entity ---
  await page.goto("/entities");
  await page.getByRole("button", { name: "New Entity" }).click();
  await page.getByRole("listitem").filter({ hasText: "Malware" }).first().click();

  let dialog = page.getByRole("dialog");
  await expect(dialog.getByText("New Malware")).toBeVisible();
  await dialog.getByLabel("Name").fill(entityName);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const entityId = new URL(page.url()).pathname.split("/").pop();

  // --- Create the indicator ---
  await page.goto("/indicators");
  await page.getByRole("button", { name: "New Indicator" }).click();
  await page.getByRole("listitem").filter({ hasText: "Regular expression" }).first().click();

  dialog = page.getByRole("dialog");
  await expect(dialog.getByText("New Regular expression")).toBeVisible();
  await dialog.getByLabel("Name").fill(indicatorName);
  await dialog.getByLabel("Pattern").fill("integration-test-\\d+");
  // Keyboard, not click -- see indicator-lifecycle.spec.ts for why.
  const diamondInput = dialog.getByLabel("Diamond model");
  await diamondInput.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: "victim" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/indicators\/[\w-]+$/);
  const indicatorId = new URL(page.url()).pathname.split("/").pop();

  // --- Link them, from the entity's details page ---
  await page.goto(`/entities/${entityId}`);
  await page.getByRole("button", { name: "new link..." }).click();
  await page.getByRole("button", { name: "entities / indicators", exact: true }).click();

  const linkDialog = page.getByRole("dialog");
  await expect(linkDialog.getByText(`New link for ${entityName}`)).toBeVisible();
  const linkTargetSearch = linkDialog.getByRole("combobox", { name: "Search for entities or indicators" });
  const saveLinkButton = linkDialog.getByRole("button", { name: "Save" });
  // Each search result is a v-list-item carrying role="option" itself, but
  // wrapping *two* buttons (the item's own name, and a separate "details"
  // link) -- Playwright's accessible-name computation for that option
  // doesn't reliably match on just the item's name text (it can silently
  // resolve to zero elements). Match by raw text via the [role="option"]
  // attribute selector instead, and click the inner name button
  // specifically, not the option/list-item wrapper as a whole.
  //
  // The autocomplete's own /entities, /indicators, /dfiq searches go
  // through the same eventually-consistent ArangoSearch views as
  // everywhere else -- retry until the freshly-created indicator actually
  // shows up and the click sticks (Save reports the target as picked).
  await expect(async () => {
    await linkTargetSearch.fill(indicatorName);
    const option = page.locator('[role="option"]').filter({ hasText: indicatorName });
    await expect(option).toBeVisible();
    await option.getByRole("button").first().click();
    await expect(saveLinkButton).toBeEnabled();
  }).toPass({ timeout: 20_000 });

  // Selecting the indicator auto-fills the link type/direction from
  // LINK_SUGGESTIONS ("indicator" -> "indicates" -> "malware", among
  // others), so there's no need to fill those in by hand.
  const linkResponse = page.waitForResponse(res => res.url().includes("/api/v2/graph/") && res.request().method() === "POST");
  await saveLinkButton.click();
  await linkResponse;

  // --- Confirm the entity's "Related indicators" tab shows the indicator ---
  // Unlike the object-search pages, DirectNeighbors' /graph/search is a
  // direct AQL graph traversal, not an ArangoSearch view -- no eventual-
  // consistency retry needed here, just Playwright's normal auto-waiting.
  //
  // Navigate with a plain page load (no #hash) and click the tab instead of
  // deep-linking to it: on a fresh full page load, the tab-selection watcher
  // that reacts to the URL hash can race the router's own initial hash
  // resolution and settle on the wrong tab (confirmed by dumping every
  // .v-window-item's active state and table contents -- the *right* tab's
  // table had the real row, but a different tab was the one actually marked
  // .v-window-item--active/display:block). Clicking the tab, like a real
  // user would, sidesteps that race entirely.
  //
  // Scope to .v-window-item--active .v-data-table -- these tabs are all
  // mounted "eager" (kept in the DOM, just display:none when inactive), and
  // the object's own "Info" side card is a plain (non-data-table) <v-table>
  // that's always present and would otherwise leak its own rows into a bare
  // "tbody tr" match.
  await page.goto(`/entities/${entityId}`);
  await page.getByRole("tab", { name: /Related indicators/ }).click();
  const entityNeighborRows = page.locator(".v-window-item--active .v-data-table tbody tr:visible");
  await expect(entityNeighborRows).toHaveCount(1);
  await expect(entityNeighborRows.first()).toContainText(indicatorName);

  // --- Confirm the indicator's "Related Malware" tab shows the entity ---
  await page.goto(`/indicators/${indicatorId}`);
  await page.getByRole("tab", { name: /Malware/ }).click();
  const indicatorNeighborRows = page.locator(".v-window-item--active .v-data-table tbody tr:visible");
  await expect(indicatorNeighborRows).toHaveCount(1);
  await expect(indicatorNeighborRows.first()).toContainText(entityName);

  // --- Cleanup ---
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  await page.request.delete(`/api/v2/entities/${entityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  await page.request.delete(`/api/v2/indicators/${indicatorId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
});
