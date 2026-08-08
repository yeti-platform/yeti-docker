import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * The Approaches tab (EditDFIQObject.vue) is the most intricate untested UI
 * in the app: nested expansion panels, an in-memory YAML document rebuilt
 * from typed fields (name/description/references/steps/coverage notes) and
 * re-validated on a 500ms debounce, same as the rest of the DFIQ dialog.
 * This creates a standalone Question, adds one approach with a reference
 * and a step, saves, and confirms it round-tripped -- both in the
 * read-only DFIQApproaches display on the details page (no reload, since
 * ObjectDetails.vue's @success handler swaps the local object in place)
 * and via a direct API GET of the persisted dfiq_yaml.
 */
test("add an approach with a reference and a step to a DFIQ question", async ({ page }) => {
  const questionName = `integration-test-question-approach-${Date.now()}`;
  const approachName = `integration-test-approach-${Date.now()}`;
  const referenceText = `https://example.com/reference-${Date.now()}`;
  const stepName = `integration-test-step-${Date.now()}`;
  const stepValue = `SELECT * FROM step_${Date.now()}`;

  await login(page);

  // --- Create a standalone question (no parents needed) ---
  await page.goto("/dfiq");
  await page.getByRole("button", { name: "New DFIQ object" }).click();
  await page.getByRole("listitem").filter({ hasText: "Question" }).first().click();

  const newDialog = page.getByRole("dialog");
  await expect(newDialog.getByText("Creating DFIQ question")).toBeVisible();
  await newDialog.getByLabel("Name").fill(questionName);
  await expect(newDialog.getByRole("button", { name: "Save" })).toBeEnabled({ timeout: 10_000 });
  await newDialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/dfiq\/[\w-]+$/);
  const questionId = new URL(page.url()).pathname.split("/").pop();

  // --- Edit: add an approach with a reference and a step ---
  await page.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog");
  await expect(editDialog.getByText("Editing DFIQ question")).toBeVisible();

  await editDialog.getByRole("tab", { name: "Approaches" }).click();
  // v-window doesn't unmount the "user-form" tab once it's been visited
  // (the dialog opens on it by default), so its own "Description" field
  // stays in the DOM and collides with the approach's -- scope to the
  // active window item, same pattern as the neighbor-table gotcha in the
  // README.
  const approachesTab = editDialog.locator(".v-window-item--active");
  await approachesTab.getByRole("button", { name: "Add approach" }).click();

  // Several of these fields (Reference, Step name) also carry a "clear"
  // append-icon whose own aria-label ("<field> appended action") fuzzy-
  // matches getByLabel too -- use getByRole("textbox", ...) instead, which
  // only matches the actual input/textarea.
  await approachesTab.getByRole("textbox", { name: "Approach name" }).fill(approachName);
  await approachesTab.getByRole("textbox", { name: "Description" }).fill("Approach description");

  await approachesTab.getByRole("button", { name: "add reference" }).click();
  await approachesTab.getByRole("textbox", { name: "Reference" }).fill(referenceText);

  await approachesTab.getByRole("button", { name: "Add step" }).click();
  await approachesTab.getByRole("textbox", { name: "Step name" }).fill(stepName);
  await approachesTab.getByLabel("Type").fill("manual");
  await approachesTab.getByLabel("Stage").fill("collection");
  await approachesTab.getByRole("textbox", { name: "Value" }).fill(stepValue);

  await expect(editDialog.getByRole("button", { name: "Save" })).toBeEnabled({ timeout: 10_000 });
  const patchResponse = page.waitForResponse(
    res => res.url().includes(`/dfiq/${questionId}`) && res.request().method() === "PATCH"
  );
  await editDialog.getByRole("button", { name: "Save" }).click();
  await patchResponse;
  await expect(editDialog).toBeHidden();

  // --- Confirm it rendered in the read-only Approaches panel, no reload ---
  // The question's own DFIQ tree tab is mounted (eagerly, same as other
  // DFIQ tree views) even though we never click into it, and it renders
  // this same step name in its own (v-show-hidden, `<ul>`-based) approach
  // node -- scope to the `<ol>` YetiDFIQApproachTemplate.vue actually uses,
  // to avoid matching that hidden duplicate.
  await page.getByRole("button", { name: approachName }).click();
  await expect(page.locator("ol li").filter({ hasText: stepName })).toBeVisible();
  await expect(page.getByText(referenceText)).toBeVisible();

  // --- Confirm it persisted server-side too ---
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  const response = await page.request.get(`/api/v2/dfiq/${questionId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const persisted = await response.json();
  expect(persisted.approaches).toHaveLength(1);
  expect(persisted.approaches[0].name).toBe(approachName);
  expect(persisted.approaches[0].references).toContain(referenceText);
  expect(persisted.approaches[0].steps).toHaveLength(1);
  expect(persisted.approaches[0].steps[0].name).toBe(stepName);
  expect(persisted.approaches[0].steps[0].value).toBe(stepValue);

  // --- Cleanup ---
  await page.request.delete(`/api/v2/dfiq/${questionId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
});
