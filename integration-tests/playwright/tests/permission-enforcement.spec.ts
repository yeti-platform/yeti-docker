import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Full lifecycle of an object's permissions, from an outsider's point of
 * view: a second, non-admin user goes from group-based Owner access, to
 * revoked, to Reader, to Writer, to Owner again on a single entity --
 * confirming at each step both that the UI gates the actions that role
 * shouldn't have (ObjectDetails.vue/EditObject.vue's
 * hasEditPerms/hasOwnerPerms, see src/store/user.ts) and that the backend
 * actually rejects an unauthorized action attempted directly against the
 * API, not just that the button is hidden. Requires RBAC enabled on the
 * stack (see docker-compose.yaml's YETI_RBAC_ENABLED) -- without it every
 * one of these checks short-circuits to "allow".
 *
 * The opening grant is to the "All users" group rather than the second user
 * directly, mirroring what yeti.conf's [rbac] default_acls is meant to do
 * automatically for every new object (core/schemas/rbac.py's set_acls()
 * grants that group Role.OWNER, despite the config comment saying "share" --
 * it's not merely read access). That automatic grant is made the same way,
 * via Group.find() -- which this test found to occasionally and silently
 * miss an existing group under load, permanently under-sharing the object
 * with no retry -- so this grants it explicitly through the same UI action
 * instead of relying on it, for a deterministic starting point.
 */
test("walk a user through default sharing, revocation, and every ACL role on an entity", async ({
  page,
  browser
}) => {
  const entityName = `integration-test-malware-${Date.now()}`;
  const username = `integration-test-user-${Date.now()}`;
  const password = "Integration-Test-Password-1!";

  await login(page);

  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();

  // --- Create the entity, as admin ---
  await page.goto("/entities");
  await page.getByRole("button", { name: "New Entity" }).click();
  await page.getByRole("listitem").filter({ hasText: "Malware" }).first().click();
  const newDialog = page.getByRole("dialog");
  await expect(newDialog.getByText("New Malware")).toBeVisible();
  await newDialog.getByLabel("Name").fill(entityName);
  await newDialog.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const entityId = new URL(page.url()).pathname.split("/").pop();

  // --- Create the second, non-admin user ---
  await page.goto("/system/users");
  await page.getByLabel("Username").fill(username);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Add user" }).click();
  await expect(page.getByRole("link", { name: username })).toBeVisible();

  // A separate browser context so the second user's own session (cookies/
  // local storage) never touches the admin's -- unlike rbac-group-membership
  // and user-global-role specs, this one needs the *browser* logged in as the
  // second user, not just their bearer token for page.request calls.
  const secondUserContext = await browser.newContext();
  const secondPage = await secondUserContext.newPage();
  await login(secondPage, username, password);

  /** Opens the entity's share dialog on the admin's page. */
  async function openShareDialog() {
    await page.goto(`/entities/${entityId}`);
    await page.getByRole("button", { name: "share" }).click();
    const aclDialog = page.getByRole("dialog");
    await expect(aclDialog.getByText("ACL for")).toBeVisible();
    return aclDialog;
  }

  /** Grants `identity` (a username or group name) the given role on the entity. */
  async function grantRole(roleLabel: "Reader" | "Writer" | "Owner", identity: string = username) {
    const aclDialog = await openShareDialog();
    const identitiesField = aclDialog.getByLabel("Select identities");
    await identitiesField.fill(identity);
    await page.getByRole("option", { name: identity }).click();
    await page.keyboard.press("Escape");

    await aclDialog.getByLabel("Role").focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("option", { name: roleLabel, exact: true }).click();

    const updateResponse = page.waitForResponse(
      res => res.url().includes("/update-members") && res.request().method() === "POST"
    );
    await aclDialog.getByRole("button", { name: "Update memberships" }).click();
    await updateResponse;
    await aclDialog.getByRole("button", { name: "Close" }).click();
  }

  /**
   * Waits for the entity's actual GET to land before returning -- a bare
   * goto()/reload() plus a retry-polling assertion can lose the race against
   * a slow render under a loaded full-suite run. Matches the *API* path
   * specifically: the frontend route the browser navigates to is also
   * "/entities/{id}" and also resolves as a GET, and resolves first, so a
   * bare substring match on the id catches that document request instead of
   * the XHR this is actually waiting for.
   */
  async function waitForEntityGet(action: () => Promise<unknown>) {
    const responsePromise = secondPage.waitForResponse(
      res => res.url().includes(`/api/v2/entities/${entityId}`) && res.request().method() === "GET"
    );
    await action();
    return responsePromise;
  }

  // --- Org-wide sharing: grant the "All users" group Owner, so every
  // registered user -- including the second user, via membership -- can
  // fully manage the entity with no individual grant ---
  await grantRole("Owner", "All users");
  await waitForEntityGet(() => secondPage.goto(`/entities/${entityId}`));
  await expect(secondPage.locator(".yeti-object-title code")).toHaveText(entityName);
  await expect(secondPage.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(secondPage.getByRole("button", { name: "share" })).toBeVisible();

  // --- Revoke that group grant: remove "All users" from the entity's ACL ---
  const aclDialogForRevoke = await openShareDialog();
  const allUsersRow = aclDialogForRevoke.locator("tbody tr").filter({ hasText: "All users" });
  await expect(allUsersRow).toBeVisible();
  const revokeResponse = page.waitForResponse(res => /\/rbac\/[^/]+$/.test(res.url()) && res.request().method() === "DELETE");
  await allUsersRow.getByRole("button").click();
  await revokeResponse;
  await expect(allUsersRow).toBeHidden();
  await aclDialogForRevoke.getByRole("button", { name: "Close" }).click();

  // Now genuinely blocked: no grant, direct or via a group, remains. The
  // toast also auto-dismisses after 3s (App.vue's v-snackbar timeout), so
  // checking it only after the response has actually landed keeps this from
  // polling too late to catch it under load.
  const forbiddenGetResponse = await waitForEntityGet(() => secondPage.goto(`/entities/${entityId}`));
  expect(forbiddenGetResponse.status()).toBe(403);
  await expect(secondPage.getByText(/Forbidden: missing privileges/)).toBeVisible();
  // ObjectDetails.vue's title <code> renders unconditionally (empty when the
  // object never loaded) -- assert on content, not visibility.
  await expect(secondPage.locator(".yeti-object-title code")).not.toContainText(entityName);

  // --- Reader (granted individually this time): can view, but neither the
  // UI edit/share actions nor a direct write attempt against the API are
  // permitted ---
  await grantRole("Reader");
  await waitForEntityGet(() => secondPage.reload());
  await expect(secondPage.locator(".yeti-object-title code")).toHaveText(entityName);
  await expect(secondPage.getByRole("button", { name: "Edit" })).not.toBeVisible();
  await expect(secondPage.getByRole("button", { name: "share" })).not.toBeVisible();

  const { access_token: readerToken } = await (
    await secondPage.request.post("/api/v2/auth/token", { form: { username, password } })
  ).json();
  const forbiddenDelete = await secondPage.request.delete(`/api/v2/entities/${entityId}`, {
    headers: { Authorization: `Bearer ${readerToken}` }
  });
  expect(forbiddenDelete.status()).toBe(403);

  // --- Writer: can edit, still can't delete or share ---
  await grantRole("Writer");
  await waitForEntityGet(() => secondPage.reload());
  await expect(secondPage.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(secondPage.getByRole("button", { name: "share" })).not.toBeVisible();

  await secondPage.getByRole("button", { name: "Edit" }).click();
  const writerEditDialog = secondPage.getByRole("dialog");
  await expect(writerEditDialog.getByRole("button", { name: "Delete object" })).not.toBeVisible();
  await writerEditDialog.getByLabel("Description").fill("edited by the writer role");
  const patchResponse = secondPage.waitForResponse(
    res => res.url().includes(`/entities/${entityId}`) && res.request().method() === "PATCH"
  );
  await writerEditDialog.getByRole("button", { name: "Save" }).click();
  await patchResponse;
  await expect(secondPage.getByText("edited by the writer role")).toBeVisible();

  // --- Owner: can also delete ---
  await grantRole("Owner");
  await waitForEntityGet(() => secondPage.reload());
  await secondPage.getByRole("button", { name: "Edit" }).click();
  const ownerEditDialog = secondPage.getByRole("dialog");
  await expect(ownerEditDialog.getByRole("button", { name: "Delete object" })).toBeVisible();
  await ownerEditDialog.getByRole("button", { name: "Delete object" }).click();

  const confirmDialog = secondPage.getByRole("dialog").last();
  await expect(confirmDialog.getByText("Are you sure you want to delete this item?")).toBeVisible();
  const deleteResponse = secondPage.waitForResponse(
    res => res.url().includes(`/entities/${entityId}`) && res.request().method() === "DELETE"
  );
  await confirmDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await deleteResponse;

  const goneResponse = await page.request.get(`/api/v2/entities/${entityId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  expect(goneResponse.status()).toBe(404);

  // --- Cleanup ---
  await secondUserContext.close();
  const usersResponse = await page.request.post("/api/v2/users/search", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { username }
  });
  const { users } = await usersResponse.json();
  for (const user of users) {
    await page.request.delete(`/api/v2/users/${user.id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  }
});
