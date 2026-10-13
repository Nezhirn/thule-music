import { expect, test as setup } from "./test";
import { apiClient, login } from "./api";

setup("import the library", async ({ baseURL }) => {
  const { data: status } = await apiClient(baseURL!).GET("/api/v1/auth/setup");
  expect(status?.needs_setup).toBe(false); // the first-run test created the admin

  const api = await login(baseURL!);
  expect((await api.POST("/api/v1/library/scan")).response.status).toBe(202);
  // Scan → import of each file → transcodes; done when nothing is queued or running.
  await expect
    .poll(async () => (await api.GET("/api/v1/library/jobs/summary")).data?.pending, {
      timeout: 60_000,
    })
    .toBe(0);
  const { data: summary } = await api.GET("/api/v1/library/jobs/summary");
  expect(summary?.failed).toBe(0);
});
