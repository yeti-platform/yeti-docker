import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

/**
 * Creates a Regex indicator, then confirms it correctly flags a matching
 * value on the "Observable matching" page (/match). Exercises the real
 * /indicators POST and /graph/match endpoints end to end.
 *
 * Unlike the other lifecycle specs, indicator matching doesn't go through
 * ArangoSearch at all: /graph/match runs the pattern against indicators
 * fetched via a direct AQL collection scan (core/database_arango.py's
 * list()), so there's no eventual-consistency window to retry against here.
 */
test("a regex indicator matches a value on the Observable matching page", async ({ page }) => {
  const name = `integration-test-regex-match-${Date.now()}`;
  const matchingValue = `evil-${Date.now()}.integration-test.example.com`;
  const pattern = "evil-\\d+\\.integration-test\\.example\\.com";

  await login(page);

  // --- Create the regex indicator ---
  await page.goto("/indicators");
  await page.getByRole("button", { name: "New Indicator" }).click();
  await page.getByRole("listitem").filter({ hasText: "Regular expression" }).first().click();

  const newDialog = page.getByRole("dialog");
  await expect(newDialog.getByText("New Regular expression")).toBeVisible();
  await newDialog.getByLabel("Name").fill(name);
  await newDialog.getByLabel("Pattern").fill(pattern);
  // Keyboard, not click -- see indicator-lifecycle.spec.ts for why.
  const diamondInput = newDialog.getByLabel("Diamond model");
  await diamondInput.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: "victim" }).click();
  await newDialog.getByRole("button", { name: "Save" }).click();

  await expect(page).toHaveURL(/\/indicators\/[\w-]+$/);
  const indicatorId = new URL(page.url()).pathname.split("/").pop();

  // --- Match it against a value on the Observable matching page ---
  await page.goto("/match");
  await page.getByRole("textbox").first().fill(matchingValue);

  const matchResponse = page.waitForResponse(
    res => res.url().includes("/api/v2/graph/match") && res.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Launch search" }).click();
  await matchResponse;

  const indicatorMatchesCard = page.locator(".v-card", { hasText: "Indicator matches" });
  await expect(indicatorMatchesCard.getByRole("row").filter({ hasText: matchingValue })).toBeVisible();
  await expect(indicatorMatchesCard.getByRole("link", { name })).toBeVisible();

  // --- Cleanup ---
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  const { access_token: accessToken } = await tokenResponse.json();
  await page.request.delete(`/api/v2/indicators/${indicatorId}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
});
