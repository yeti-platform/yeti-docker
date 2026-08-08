import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * RBAC (users, groups, ACLEdit) has zero coverage in this suite despite being
 * a whole feature area, and the frontend already carries a known workaround
 * for a backend/OpenAPI schema mismatch on the `Permission` IntFlag (see
 * services/rbac.ts and services/users.ts) -- this exercises exactly that
 * code path. Creates a user and a group through the admin UI, grants the
 * user a Writer role on the group via ACLEdit, and confirms it both in the
 * UI and via a direct API check of the persisted ACL edge.
 */
test("create a user and a group, then grant the user a Writer role on the group", async ({ page }) => {
  const username = `integration-test-user-${Date.now()}`;
  const password = "Integration-Test-Password-1!";
  const groupName = `integration-test-group-${Date.now()}`;

  await login(page);

  // --- Create a user ---
  await page.goto("/system/users");
  await page.getByLabel("Username").fill(username);
  // getByLabel("Password") also fuzzy-matches the show/hide-password
  // append icon's own "Password appended action" aria-label -- scope to
  // the actual input via role, same fix as elsewhere in this suite.
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.getByRole("link", { name: username })).toBeVisible();

  // --- Create a group ---
  await page.goto("/system/groups");
  await page.getByRole("button", { name: "Create group" }).click();
  const newGroupDialog = page.getByRole("dialog");
  await expect(newGroupDialog.getByText("New group")).toBeVisible();
  await newGroupDialog.getByLabel("Name").fill(groupName);
  await newGroupDialog.getByRole("button", { name: "Create group" }).click();
  await expect(newGroupDialog).toBeHidden();

  const groupRow = page.locator("tbody tr").filter({ hasText: groupName });
  await expect(groupRow).toBeVisible();

  // --- Grant the user a Writer role on the group, via ACLEdit ---
  await groupRow.locator("button", { has: page.locator(".mdi-account-multiple-plus-outline") }).click();
  const aclDialog = page.getByRole("dialog");
  await expect(aclDialog.getByText(`ACL for`)).toBeVisible();

  const identitiesField = aclDialog.getByLabel("Select identities");
  await identitiesField.fill(username);
  // The combobox's dropdown menu teleports to the shared overlay root, not
  // nested under the dialog's own DOM subtree -- same underlying Vuetify
  // behavior as the nested-dialog gotcha documented in the README, just
  // for a combobox menu instead. Query unscoped.
  await page.getByRole("option", { name: username }).click();
  // The identities combobox is multi-select, so picking an option doesn't
  // close its dropdown (more could be picked) -- close it, or it sits on
  // top of the Role select below.
  await page.keyboard.press("Escape");

  // The Role v-select doesn't reliably respond to .click() (see
  // tests/indicator-lifecycle.spec.ts / the README) -- focus and drive it
  // with the keyboard instead.
  await aclDialog.getByLabel("Role").focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: "Writer" }).click();

  const updateResponse = page.waitForResponse(
    res => res.url().includes("/update-members") && res.request().method() === "POST"
  );
  await aclDialog.getByRole("button", { name: "Update memberships" }).click();
  await updateResponse;

  await expect(aclDialog.locator("tbody tr").filter({ hasText: username })).toContainText("Writer");
  await aclDialog.getByRole("button", { name: "Close" }).click();

  // --- Confirm it persisted server-side, as the exact IntFlag value (3) ---
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  const groupsResponse = await page.request.post("/api/v2/groups/search", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name: groupName }
  });
  const { groups } = await groupsResponse.json();
  expect(groups).toHaveLength(1);
  const groupId = groups[0].id;

  const aclResponse = await page.request.get(`/api/v2/rbac/rbacgroup/${groupId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const acls: Record<string, { role: number }> = (await aclResponse.json()).acls;
  const membership = Object.entries(acls).find(([name]) => name === username);
  expect(membership).toBeDefined();
  expect(membership?.[1].role).toBe(3);

  // --- Cleanup ---
  await page.request.delete(`/api/v2/groups/${groupId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const usersResponse = await page.request.post("/api/v2/users/search", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { username }
  });
  const { users } = await usersResponse.json();
  for (const user of users) {
    await page.request.delete(`/api/v2/users/${user.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  }
});
