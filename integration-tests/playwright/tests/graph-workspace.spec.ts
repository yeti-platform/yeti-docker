import { expect, test } from "@playwright/test";
import { login, TEST_PASSWORD, TEST_USERNAME } from "./helpers";

interface CreatedObject {
  id: string;
  type: string;
}

test("investigate directed evidence and add a second anchor without mutating the graph", async ({ page }) => {
  const suffix = Date.now();
  const firstName = `integration-graph-malware-a-${suffix}`;
  const secondName = `integration-graph-malware-b-${suffix}`;
  const hostname = `integration-graph-${suffix}.example.com`;
  const createdPaths: string[] = [];

  await login(page);
  const tokenResponse = await page.request.post("/api/v2/auth/token", {
    form: { username: TEST_USERNAME, password: TEST_PASSWORD }
  });
  expect(tokenResponse.ok()).toBeTruthy();
  const { access_token: accessToken } = await tokenResponse.json();
  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    const createEntity = async (name: string) => {
      const response = await page.request.post("/api/v2/entities/", {
        headers,
        data: { entity: { name, type: "malware" } }
      });
      expect(response.ok()).toBeTruthy();
      return (await response.json()) as CreatedObject;
    };
    const first = await createEntity(firstName);
    const second = await createEntity(secondName);
    const observableResponse = await page.request.post("/api/v2/observables/extended", {
      headers,
      data: { observable: { value: hostname, type: "hostname" } }
    });
    expect(observableResponse.ok()).toBeTruthy();
    const observable = (await observableResponse.json()) as CreatedObject;
    createdPaths.push(`/api/v2/entities/${first.id}`, `/api/v2/entities/${second.id}`, `/api/v2/observables/${observable.id}`);

    for (const [source, description] of [
      [first, "First synthetic directed relationship"],
      [second, "Second synthetic directed relationship"]
    ] as const) {
      const response = await page.request.post("/api/v2/graph/add", {
        headers,
        data: {
          source: `${source.type}/${source.id}`,
          target: `${observable.type}/${observable.id}`,
          link_type: "communicates-with",
          description
        }
      });
      expect(response.ok()).toBeTruthy();
    }

    const mutationRequests: string[] = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/v2/graph/")) return;
      if (path === "/api/v2/graph/explore" || path === "/api/v2/graph/search") return;
      mutationRequests.push(`${request.method()} ${path}`);
    });

    await page.goto(`/entities/${first.id}`);
    await page.getByRole("link", { name: "Explore in graph" }).click();

    await expect(page).toHaveURL(/\/graph#/);
    await expect(page.getByRole("heading", { name: "Evidence" })).toBeVisible();
    await expect(page.getByText("2 objects")).toBeVisible();
    await expect(page.getByText("1 relationships")).toBeVisible();
    await expect(page.getByRole("cell", { name: `entities/${first.id} → observables/${observable.id}` })).toBeVisible();
    await expect(page.getByText("First synthetic directed relationship")).toBeVisible();

    const objectIds = page.getByLabel("Yeti object IDs");
    await expect(objectIds).toHaveValue(`entities/${first.id}`);
    await objectIds.fill(`entities/${first.id}\nentities/${second.id}`);
    await page.getByRole("button", { name: "Explore objects" }).click();

    await expect(page.getByText("3 objects")).toBeVisible();
    await expect(page.getByText("2 relationships")).toBeVisible();
    await expect(page.getByRole("button", { name: firstName, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: secondName, exact: true })).toBeVisible();
    await expect(page.getByText("Second synthetic directed relationship")).toBeVisible();
    expect(mutationRequests).toEqual([]);
  } finally {
    for (const path of createdPaths) {
      await page.request.delete(path, { headers });
    }
  }
});
