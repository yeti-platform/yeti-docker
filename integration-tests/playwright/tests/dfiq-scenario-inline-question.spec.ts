import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Creates a DFIQ Scenario, then -- from the scenario's own "DFIQ tree" tab
 * (DFIQTree.vue's inline "new question" button, not the top-level "New DFIQ
 * object" flow) -- creates a Question as its child. Confirms the question
 * shows up nested under the scenario in the tree.
 */
test("create a scenario, then add a question inline from its DFIQ tree", async ({ page }) => {
  const scenarioName = `integration-test-scenario-${Date.now()}`;
  const questionName = `integration-test-question-${Date.now()}`;

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

  // --- Add a question inline, from the DFIQ tree tab ---
  await page.getByRole("tab", { name: /DFIQ tree/ }).click();
  const scenarioRow = page.locator("li").filter({ hasText: scenarioName }).first();
  // The "new facet"/"new question" buttons are hidden until the row is
  // hovered (CSS `li:hover > span > .item-controls`), matching the DFIQ
  // tree's own real-user interaction model.
  await scenarioRow.hover();
  await scenarioRow.getByRole("button", { name: "new question" }).click();

  const newQuestionDialog = page.getByRole("dialog").last();
  await expect(newQuestionDialog.getByText("Creating DFIQ question")).toBeVisible();
  await expect(newQuestionDialog.getByText(`pre-populated from scenario "${scenarioName}"`)).toBeVisible();
  await newQuestionDialog.getByLabel("Name").fill(questionName);
  await expect(newQuestionDialog.getByRole("button", { name: "Save" })).toBeEnabled({ timeout: 10_000 });
  await newQuestionDialog.getByRole("button", { name: "Save" }).click();

  // No redirect for the inline-create path -- the dialog just closes and the
  // (already-mounted, eager) top-level tree refetches via the DFIQupdated
  // event bus, so the new question should appear nested under the scenario
  // without a page reload.
  await expect(newQuestionDialog).toBeHidden();
  const questionRow = page.locator("li").filter({ hasText: questionName }).first();
  await expect(questionRow).toBeVisible();

  // --- Cleanup ---
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  // The question was created moments ago -- the ArangoSearch view backing
  // /dfiq/search is eventually consistent (same gotcha as elsewhere in
  // this suite), so a single one-shot search can miss it here and
  // silently skip its deletion rather than fail loudly. Retry until it
  // shows up.
  let questionMatches: { id: string }[] = [];
  await expect(async () => {
    const searchResponse = await page.request.post("/api/v2/dfiq/search", {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { query: { name: questionName }, count: 10, page: 0, sorting: [] }
    });
    ({ dfiq: questionMatches } = await searchResponse.json());
    expect(questionMatches.length).toBeGreaterThan(0);
  }).toPass({ timeout: 20_000 });
  for (const match of questionMatches) {
    await page.request.delete(`/api/v2/dfiq/${match.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  }
  await page.request.delete(`/api/v2/dfiq/${scenarioId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
});
