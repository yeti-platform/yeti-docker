import { type Page, expect } from "@playwright/test";

export const TEST_USERNAME = process.env.TEST_USERNAME ?? "integration-test";
export const TEST_PASSWORD = process.env.TEST_PASSWORD ?? "Integration-Test-Password-1!";

/** Logs in through the real login form against the real backend. */
export async function login(page: Page, username: string = TEST_USERNAME, password: string = TEST_PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/observables/);
}
