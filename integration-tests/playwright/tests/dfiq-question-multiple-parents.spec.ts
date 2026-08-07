import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Creates two DFIQ Scenarios, then a Question (via the top-level "New DFIQ
 * object" flow, not the tree's inline create) associated to *both* via the
 * "Parents" field. Confirms the question appears under both scenarios'
 * DFIQ trees.
 */
test("create a question and associate it to two scenarios via the Parents field", async ({ page }) => {
  const scenarioAName = `integration-test-scenario-a-${Date.now()}`;
  const scenarioBName = `integration-test-scenario-b-${Date.now()}`;
  const questionName = `integration-test-question-${Date.now()}`;

  await login(page);

  async function createScenario(name: string): Promise<string> {
    await page.goto("/dfiq");
    await page.getByRole("button", { name: "New DFIQ object" }).click();
    await page.getByRole("listitem").filter({ hasText: "Scenario" }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Creating DFIQ scenario")).toBeVisible();
    await dialog.getByLabel("Name").fill(name);
    await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled({ timeout: 10_000 });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(page).toHaveURL(/\/dfiq\/[\w-]+$/);
    return new URL(page.url()).pathname.split("/").pop() as string;
  }

  const scenarioAId = await createScenario(scenarioAName);
  const scenarioBId = await createScenario(scenarioBName);

  // The "Parents" field's options come from a single /api/v2/dfiq/search
  // done once when the dialog mounts (not re-queried per keystroke), so --
  // unlike the tree's inline-create path -- there's a real ArangoSearch-view
  // consistency window here: make sure both scenarios are actually
  // searchable before opening the dialog, since re-typing later won't
  // re-trigger that initial fetch.
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  await expect(async () => {
    const response = await page.request.post("/api/v2/dfiq/search", {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { query: { name: "integration-test-scenario-" }, count: 20, page: 0, sorting: [] }
    });
    const { dfiq: matches } = await response.json();
    const names = matches.map((m: { name: string }) => m.name);
    expect(names).toEqual(expect.arrayContaining([scenarioAName, scenarioBName]));
  }).toPass({ timeout: 20_000 });

  // --- Create the question, linking both scenarios via "Parents" ---
  await page.goto("/dfiq");
  await page.getByRole("button", { name: "New DFIQ object" }).click();
  await page.getByRole("listitem").filter({ hasText: "Question" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Creating DFIQ question")).toBeVisible();
  await dialog.getByLabel("Name").fill(questionName);

  const parentsField = dialog.getByLabel("Parents");
  await parentsField.click();
  await parentsField.fill(scenarioAName);
  await page.getByRole("option", { name: scenarioAName }).click();
  await parentsField.fill(scenarioBName);
  await page.getByRole("option", { name: scenarioBName }).click();
  await expect(dialog.getByText(scenarioAName)).toBeVisible();
  await expect(dialog.getByText(scenarioBName)).toBeVisible();

  await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/dfiq\/[\w-]+$/);
  const questionId = new URL(page.url()).pathname.split("/").pop();

  // --- Confirm the question appears under both scenarios' DFIQ trees ---
  for (const scenarioId of [scenarioAId, scenarioBId]) {
    await page.goto(`/dfiq/${scenarioId}`);
    await page.getByRole("tab", { name: /DFIQ tree/ }).click();
    const questionRow = page.locator("li").filter({ hasText: questionName }).first();
    await expect(questionRow).toBeVisible();
  }

  // --- Cleanup ---
  await page.request.delete(`/api/v2/dfiq/${questionId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  await page.request.delete(`/api/v2/dfiq/${scenarioAId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  await page.request.delete(`/api/v2/dfiq/${scenarioBId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
});
