import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * RBAC (users, groups, ACLEdit) has zero coverage in this suite despite being
 * a whole feature area, and the frontend already carries a known workaround
 * for a backend/OpenAPI schema mismatch on the `Permission` IntFlag (see
 * services/rbac.ts and services/users.ts) -- this exercises exactly that
 * code path. Creates a user and a group through the admin UI, then grants
 * the user each of the three roles ACLEdit's UI actually offers (Reader,
 * Writer, Owner), confirming both in the UI and via a direct API check of
 * the persisted ACL edge's exact role value each time.
 */
test("create a user and a group, then grant the user every ACL role the UI offers", async ({ page }) => {
  const username = `integration-test-user-${Date.now()}`;
  const password = "Integration-Test-Password-1!";
  const groupName = `integration-test-group-${Date.now()}`;

  await login(page);

  // --- Create a user ---
  await page.goto("/system/users");
  await page.getByLabel("Username").fill(username);
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

  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  const groupsResponse = await page.request.post("/api/v2/groups/search", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { name: groupName }
  });
  const groupId = (await groupsResponse.json()).groups[0].id;

  // Every ACL role ACLEdit's own UI offers ("No access" isn't one of them --
  // that's only reachable through a user's global role, covered separately
  // in user-global-role.spec.ts), each with its exact expected IntFlag value.
  const rolesUnderTest: Array<[label: string, value: number]> = [
    ["Reader", 1],
    ["Writer", 3],
    ["Owner", 7]
  ];

  for (const [roleLabel, roleValue] of rolesUnderTest) {
    // Reopen fresh each iteration rather than relying on the dialog staying
    // open across iterations -- dismissing the identities combobox's own
    // dropdown (below) can close the whole ACLEdit dialog with it, since
    // Escape isn't guaranteed to only close the topmost nested overlay.
    await groupRow.locator("button", { has: page.locator(".mdi-account-multiple-plus-outline") }).click();
    const aclDialog = page.getByRole("dialog");
    await expect(aclDialog.getByText(`ACL for`)).toBeVisible();

    const identitiesField = aclDialog.getByLabel("Select identities");
    await identitiesField.fill(username);
    // The combobox's dropdown menu teleports to the shared overlay root, not
    // nested under the dialog's own DOM subtree -- query unscoped.
    await page.getByRole("option", { name: username }).click();
    // Multi-select combobox: picking an option doesn't close its dropdown.
    await page.keyboard.press("Escape");

    // The Role v-select doesn't reliably respond to .click() -- focus and
    // drive it with the keyboard instead.
    await aclDialog.getByLabel("Role").focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("option", { name: roleLabel, exact: true }).click();

    const updateResponse = page.waitForResponse(
      res => res.url().includes("/update-members") && res.request().method() === "POST"
    );
    await aclDialog.getByRole("button", { name: "Update memberships" }).click();
    await updateResponse;

    await expect(aclDialog.locator("tbody tr").filter({ hasText: username })).toContainText(roleLabel);

    const aclResponse = await page.request.get(`/api/v2/rbac/rbacgroup/${groupId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const acls: Record<string, { role: number }> = (await aclResponse.json()).acls;
    expect(acls[username]?.role).toBe(roleValue);

    await aclDialog.getByRole("button", { name: "Close" }).click();
  }

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
