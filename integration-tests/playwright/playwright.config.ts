import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  // Unlike the frontend's own mocked e2e suite, these tests share one real
  // backend and database -- run sequentially to avoid cross-test interference
  // (e.g. a search assertion racing another test's in-flight create).
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL ?? "http://127.0.0.1:18080",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
