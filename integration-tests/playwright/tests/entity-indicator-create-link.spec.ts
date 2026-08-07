import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Creates a Malware entity, then -- entirely from within the "link objects"
 * dialog (LinkObject.vue's own "New Indicator" button, not a separate
 * pre-existing object) -- creates a Regex indicator and links it to the
 * entity in one flow. Confirms the link shows up in both objects' "Related
 * X" neighbor tables, same as entity-indicator-link.spec.ts, but exercising
 * the *inline create* path (NewObject nested inside LinkObject, itself
 * nested inside the "new link..." menu) instead of searching for an
 * existing object via EntitySelector.
 */
test("create an entity, then create and link a new indicator to it from the link dialog", async ({ page }) => {
  const entityName = `integration-test-malware-${Date.now()}`;
  const indicatorName = `integration-test-regex-${Date.now()}`;

  await login(page);

  // --- Create the entity ---
  await page.goto("/entities");
  await page.getByRole("button", { name: "New Entity" }).click();
  await page.getByRole("listitem").filter({ hasText: "Malware" }).first().click();

  const newEntityDialog = page.getByRole("dialog");
  await expect(newEntityDialog.getByText("New Malware")).toBeVisible();
  await newEntityDialog.getByLabel("Name").fill(entityName);
  await newEntityDialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const entityId = new URL(page.url()).pathname.split("/").pop();

  // --- Open the link dialog, then create the indicator from inside it ---
  await page.goto(`/entities/${entityId}`);
  await page.getByRole("button", { name: "new link..." }).click();
  await page.getByRole("button", { name: "entities / indicators", exact: true }).click();

  // .first() -- LinkObject's own dialog opened first (before the nested
  // NewObject dialog below), and staying pinned to it keeps every later
  // linkDialog.* lookup unambiguous regardless of whether the inner
  // dialog's close transition has fully finished by then.
  const linkDialog = page.getByRole("dialog").first();
  await expect(linkDialog.getByText(`New link for ${entityName}`)).toBeVisible();

  await linkDialog.getByRole("button", { name: "New Indicator" }).click();
  // The type-picker menu's own content teleports to the shared overlay root
  // like every other Vuetify overlay in this app, not nested under
  // linkDialog's own DOM subtree -- query unscoped, same as the
  // newIndicatorDialog lookup below.
  await page.getByRole("listitem").filter({ hasText: "Regular expression" }).first().click();

  // NewObject opens as a *third* stacked dialog (menu -> LinkObject dialog ->
  // this one) -- getByRole("dialog") is unscoped at this point since it must
  // match a node outside linkDialog's own subtree (Vuetify teleports each
  // dialog's content to a shared overlay root, not nested under its
  // logical parent) -- .last() picks the most-recently-opened one.
  const newIndicatorDialog = page.getByRole("dialog").last();
  await expect(newIndicatorDialog.getByText("New Regular expression")).toBeVisible();
  await newIndicatorDialog.getByLabel("Name").fill(indicatorName);
  await newIndicatorDialog.getByLabel("Pattern").fill("integration-test-\\d+");
  // Keyboard, not click -- see indicator-lifecycle.spec.ts for why.
  const diamondInput = newIndicatorDialog.getByLabel("Diamond model");
  await diamondInput.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: "victim" }).click();
  await newIndicatorDialog.getByRole("button", { name: "Save" }).click();

  // Back in the link dialog: creating succeeds with redirect=false, so
  // NewObject just closes and LinkObject.vue's assignLinkTarget() picks up
  // the created indicator as the link target directly (no need to search
  // for it -- unlike entity-indicator-link.spec.ts, there's no
  // ArangoSearch-view lag to retry against here at all).
  // Save being enabled is the real signal that linkTarget got set -- the
  // entity-selector's own chip and the dialog's small link-preview table
  // both separately render the indicator's name as a chip, so asserting on
  // that text is ambiguous (matches twice) and adds nothing Save-enabled
  // doesn't already cover.
  const saveLinkButton = linkDialog.getByRole("button", { name: "Save" });
  await expect(saveLinkButton).toBeEnabled();

  // assignLinkTarget() (the inline-create path) doesn't auto-fill the link
  // type/direction the way targetSelected() (the search-for-existing path)
  // does, so fill it in by hand. Direction is left at its default (entity
  // -> indicator) -- direction doesn't affect whether the link shows up in
  // either side's neighbors table (DirectNeighbors queries with
  // direction: "any").
  await linkDialog.getByLabel(/Link type/).fill("indicates");

  const linkResponse = page.waitForResponse(res => res.url().includes("/api/v2/graph/") && res.request().method() === "POST");
  await saveLinkButton.click();
  const linkResponseBody = await (await linkResponse).json();
  // Don't assume which field is the indicator -- read whichever of
  // source/target actually has root_type "indicator".
  const indicatorId = [linkResponseBody.source, linkResponseBody.target]
    .map(String)
    .find(ref => ref.startsWith("indicator"))
    ?.split("/")[1];
  expect(indicatorId).toBeTruthy();

  // --- Confirm the entity's "Related indicators" tab shows the indicator ---
  // Direct-neighbor tabs are all mounted "eager" (kept in the DOM, just
  // display:none when inactive) -- scope to .v-window-item--active to pick
  // the one real tab, and to .v-data-table to exclude the object's own
  // "Info" side panel (a plain, always-present <v-table>). Navigate without
  // a #hash and click the tab instead of deep-linking to it -- on a fresh
  // page load, hash-driven tab selection can race Vue Router's own initial
  // hash resolution and land on the wrong tab (see
  // entity-indicator-link.spec.ts for the full story).
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
