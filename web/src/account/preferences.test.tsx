import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { preferencesQuery } from "../auth/queries";
import { apiError, PREFERENCES, url } from "../test/api";
import { server } from "../test/server";
import { useUpdatePreferences, type Preferences, type PreferencesChange } from "./preferences";

/** A server whose answers to PATCH /me/preferences the test releases one by one. */
function slowServer() {
  let stored: Preferences = { ...PREFERENCES };
  const pending: { change: PreferencesChange; answer(fail: boolean): void }[] = [];
  server.use(
    http.patch(url("/api/v1/me/preferences"), async ({ request }) => {
      const change = (await request.json()) as PreferencesChange;
      const fail = await new Promise<boolean>((answer) => pending.push({ change, answer }));
      if (fail) return apiError("http_error", 500);
      stored = { ...stored, ...change };
      return HttpResponse.json(stored);
    }),
  );
  return {
    pending,
    /** Answers the n-th request still waiting (in the order they arrived). */
    async answer(n: number, { fail = false } = {}) {
      await waitFor(() => expect(pending.length).toBeGreaterThan(n));
      pending.splice(n, 1)[0]!.answer(fail);
    },
  };
}

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(preferencesQuery.queryKey, { ...PREFERENCES });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useUpdatePreferences(), { wrapper });
  return {
    change: (change: PreferencesChange) => act(() => result.current.mutate(change)),
    cached: () => queryClient.getQueryData(preferencesQuery.queryKey),
    settled: () => waitFor(() => expect(queryClient.isMutating()).toBe(0)),
  };
}

test("a change applies at once and stays once saved", async () => {
  const server = slowServer();
  const { change, cached, settled } = setup();
  await change({ blur: false });
  await waitFor(() => expect(cached()?.blur).toBe(false));
  await server.answer(0);
  await settled();
  expect(cached()).toEqual({ ...PREFERENCES, blur: false });
});

test("a refused change is put back, other changes stay", async () => {
  const server = slowServer();
  const { change, cached, settled } = setup();
  await change({ blur: false });
  await change({ accent_color: "#15803d" });
  await waitFor(() => expect(cached()).toMatchObject({ blur: false, accent_color: "#15803d" }));

  await server.answer(0, { fail: true });
  await waitFor(() => expect(cached()?.blur).toBe(true));
  expect(cached()?.accent_color).toBe("#15803d");
  await server.answer(0);
  await settled();
  expect(cached()).toEqual({ ...PREFERENCES, accent_color: "#15803d" });
});

test("the answer to an earlier change doesn't undo a later one", async () => {
  const server = slowServer();
  const { change, cached, settled } = setup();
  await change({ accent_color: "#dc2626" });
  await change({ accent_color: "#2563eb" });
  await server.answer(0); // the server's answer still says red
  await waitFor(() => expect(server.pending).toHaveLength(1));
  expect(cached()?.accent_color).toBe("#2563eb");
  await server.answer(0);
  await settled();
  expect(cached()?.accent_color).toBe("#2563eb");
});

test("a refused earlier change doesn't put back a value changed again since", async () => {
  const server = slowServer();
  const { change, cached, settled } = setup();
  await change({ accent_color: "#dc2626" });
  await change({ accent_color: "#2563eb" });
  await server.answer(0, { fail: true });
  await waitFor(() => expect(server.pending).toHaveLength(1));
  expect(cached()?.accent_color).toBe("#2563eb");
  await server.answer(0);
  await settled();
  expect(cached()?.accent_color).toBe("#2563eb");
});
