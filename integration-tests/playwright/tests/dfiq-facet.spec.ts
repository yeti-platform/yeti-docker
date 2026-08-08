import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Facet is a full DFIQ type (scenario -> facet -> question) that no other
 * spec ever creates. Facets always require a parent scenario (the create
 * template embeds a non-empty parent_ids), so -- like
 * dfiq-scenario-inline-question.spec.ts's question -- this creates one via
 * the DFIQ tree's inline "new facet" button rather than the top-level "New
 * DFIQ object" flow, which has no parent to supply.
 */
test("create a scenario, then add a facet inline from its DFIQ tree", async ({ page }) => {
  const scenarioName = `integration-test-scenario-${Date.now()}`;
  const facetName = `integration-test-facet-${Date.now()}`;

  await login(page);

  // --- Create the scenario ---
  await page.goto("/dfiq");
  await page.getByRole("button", { name: "New DFIQ object" }).click();
  await page.getByRole("listitem").filter({ hasText: "Scenario" }).first().click();

  const newScenarioDialog = page.getByRole("dialog");
  await expect(newScenarioDialog.getByText("Creating DFIQ scenario")).toBeVisible();
  await newScenarioDialog.getByLabel("Name").fill(scenarioName);
  await expect(newScenarioDialog.getByRole("button", { name: "Save" })).toBeEnabled({ timeout: 10_000 });
  await newScenarioDialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/dfiq\/[\w-]+$/);
  const scenarioId = new URL(page.url()).pathname.split("/").pop();

  // --- Add a facet inline, from the DFIQ tree tab ---
  await page.getByRole("tab", { name: /DFIQ tree/ }).click();
  const scenarioRow = page.locator("li").filter({ hasText: scenarioName }).first();
  await scenarioRow.hover();
  await scenarioRow.getByRole("button", { name: "new facet" }).click();

  const newFacetDialog = page.getByRole("dialog").last();
  await expect(newFacetDialog.getByText("Creating DFIQ facet")).toBeVisible();
  await expect(newFacetDialog.getByText(`pre-populated from scenario "${scenarioName}"`)).toBeVisible();
  await newFacetDialog.getByLabel("Name").fill(facetName);
  await expect(newFacetDialog.getByRole("button", { name: "Save" })).toBeEnabled({ timeout: 10_000 });
  await newFacetDialog.getByRole("button", { name: "Save" }).click();

  // No redirect for the inline-create path -- the dialog just closes and the
  // tree refetches via the DFIQupdated event bus (see
  // dfiq-scenario-inline-question.spec.ts for the same pattern).
  await expect(newFacetDialog).toBeHidden();
  const facetRow = page.locator("li").filter({ hasText: facetName }).first();
  await expect(facetRow).toBeVisible();

  // A facet's own tree row should offer "new question" (it can parent
  // questions) but not "new facet" (facets can't parent facets) --
  // confirms DFIQHierarchy's per-type children are wired correctly, not
  // just that some node got created somewhere in the tree.
  await facetRow.hover();
  await expect(facetRow.getByRole("button", { name: "new question" })).toBeVisible();
  await expect(facetRow.getByRole("button", { name: "new facet" })).toHaveCount(0);

  // --- Cleanup ---
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  // The facet was created moments ago -- the ArangoSearch view backing
  // /dfiq/search is eventually consistent (same gotcha as elsewhere in
  // this suite), so a single one-shot search can miss it here and
  // silently skip its deletion rather than fail loudly. Retry until it
  // shows up.
  let facetMatches: { id: string }[] = [];
  await expect(async () => {
    const searchResponse = await page.request.post("/api/v2/dfiq/search", {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { query: { name: facetName }, count: 10, page: 0, sorting: [] }
    });
    ({ dfiq: facetMatches } = await searchResponse.json());
    expect(facetMatches.length).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });
  for (const match of facetMatches) {
    await page.request.delete(`/api/v2/dfiq/${match.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  }
  await page.request.delete(`/api/v2/dfiq/${scenarioId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
});
