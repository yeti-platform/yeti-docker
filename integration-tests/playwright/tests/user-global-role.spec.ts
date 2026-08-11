import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Exercises the other half of the Permission/Role schema fix: a user's
 * *global* role (PatchRoleRequest, set from UserProfile.vue's "Global role"
 * combobox), not a per-object ACL grant (covered by
 * rbac-group-membership.spec.ts). This is the one place "No access" (0) is
 * actually offered and reachable through the UI -- ACLEdit's own role
 * picker never offers it -- so it's the only real UI path that exercises
 * the boundary value the whole Permission-IntFlag-vs-OpenAPI bug was about
 * (0 is a real, meaningful value the old `1 | 2 | 4` generated type could
 * never express).
 */
test("set a user's global role through every value the UI offers", async ({ page }) => {
  const username = `integration-test-user-${Date.now()}`;
  const password = "Integration-Test-Password-1!";

  await login(page);

  await page.goto("/system/users");
  await page.getByLabel("Username").fill(username);
  await page.getByRole("textbox", { name: "Password" }).fill(password);
  await page.getByRole("button", { name: "Add user" }).click();
  const userLink = page.getByRole("link", { name: username });
  await expect(userLink).toBeVisible();
  await userLink.click();
  await expect(page).toHaveURL(/\/profile\/\d+$/);
  const userId = new URL(page.url()).pathname.split("/").pop();

  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();

  // Every option roleMapping actually offers, in UI order, with its exact
  // expected IntFlag value -- including 0, unreachable anywhere else in the UI.
  const rolesUnderTest: Array<[label: string, value: number]> = [
    ["No access", 0],
    ["Read only", 1],
    ["Read/write", 3],
    ["Admin", 7]
  ];

  // getByLabel matches both the input and its dropdown listbox (both share
  // the same aria-labelledby) -- scope to the combobox role specifically.
  const globalRoleField = page.getByRole("combobox", { name: "Global role" });

  for (const [roleLabel, roleValue] of rolesUnderTest) {
    await globalRoleField.focus();
    await page.keyboard.press("ArrowDown");
    const patchResponse = page.waitForResponse(
      res => res.url().includes("/users/role") && res.request().method() === "PATCH"
    );
    await page.getByRole("option", { name: roleLabel, exact: true }).click();
    await patchResponse;

    const userResponse = await page.request.get(`/api/v2/users/${userId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await userResponse.json();
    expect(data.user.global_role).toBe(roleValue);
  }

  // --- Cleanup ---
  await page.request.delete(`/api/v2/users/${userId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
});
