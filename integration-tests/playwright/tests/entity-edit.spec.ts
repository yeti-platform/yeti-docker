import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * None of the other specs ever edit an existing object -- they all do
 * create -> search/tag -> delete. This exercises the generic Edit dialog
 * (EditObject.vue + ObjectFields.vue, shared by every object type) via the
 * entity family: create a Malware entity with no description, edit it to
 * add one, and confirm it persisted on the details page and via a direct
 * API GET.
 */
test("edit an existing entity's description", async ({ page }) => {
  const name = `integration-test-malware-edit-${Date.now()}`;
  const description = `Updated description ${Date.now()}`;

  await login(page);

  // --- Create (no description) ---
  await page.goto("/entities");
  await page.getByRole("button", { name: "New Entity" }).click();
  await page.getByRole("listitem").filter({ hasText: "Malware" }).first().click();

  const newDialog = page.getByRole("dialog");
  await expect(newDialog.getByText("New Malware")).toBeVisible();
  await newDialog.getByLabel("Name").fill(name);
  await newDialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const entityId = new URL(page.url()).pathname.split("/").pop();
  await expect(page.locator(".yeti-description")).toContainText("No description provided");

  // --- Edit ---
  await page.getByRole("button", { name: "Edit" }).click();
  const editDialog = page.getByRole("dialog");
  await expect(editDialog.getByText("Editing Malware")).toBeVisible();
  await editDialog.getByLabel("Description").fill(description);

  const patchResponse = page.waitForResponse(
    res => res.url().includes(`/entities/${entityId}`) && res.request().method() === "PATCH"
  );
  await editDialog.getByRole("button", { name: "Save" }).click();
  await patchResponse;
  await expect(editDialog).toBeHidden();

  // --- Confirm it persisted, without a reload ---
  await expect(page.locator(".yeti-description")).toContainText(description);

  // --- Confirm it persisted server-side too ---
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  const response = await page.request.get(`/api/v2/entities/${entityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  expect((await response.json()).description).toBe(description);

  // --- Cleanup ---
  await page.request.delete(`/api/v2/entities/${entityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
});
