import { expect, test as setup } from "@playwright/test";
import { ADMIN, apiClient, login } from "./api";

setup("create the admin and import the library", async ({ baseURL }) => {
  const anonymous = apiClient(baseURL!);
  const { response } = await anonymous.POST("/api/v1/auth/register", { body: ADMIN });
  expect(response.status).toBe(201);

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
