import { test } from "@playwright/test";
import { login } from "./helpers";

/** Fast, isolated check that real auth works end to end (real /auth/token,
 * real /auth/me) before the heavier lifecycle test runs. */
test("logs in against the real backend", async ({ page }) => {
  await login(page);
});
