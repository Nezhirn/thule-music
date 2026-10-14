import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { ApiFailure } from "../api/errors";
import { createQueryClient, retryDelay } from "../queryClient";
import { mockAccount, renderSignedIn } from "../test/account";
import { apiError, url } from "../test/api";
import { WIND, album, albumDetail, page, track } from "../test/catalog";
import { server } from "../test/server";

const QUIET = album("Тихие города", WIND);
const TRACKS = [track("Рассвет", QUIET, [WIND])];

/** The album's artist, for "More by". */
const artist = () =>
  http.get(url(`/api/v1/artists/${WIND.id}`), () => HttpResponse.json({ albums: [] }));

test("a refresh that fails keeps the page, with a way to try again", async () => {
  mockAccount();
  let down = false;
  server.use(
    artist(),
    http.get(url(`/api/v1/albums/${QUIET.id}`), () =>
      down
        ? new HttpResponse("Bad Gateway", { status: 502 })
        : HttpResponse.json(albumDetail(QUIET, TRACKS)),
    ),
  );
  const { user, queryClient } = renderSignedIn(`/albums/${QUIET.id}`);
  const title = await screen.findByRole("heading", { level: 1, name: "Тихие города" });
  down = true;
  await act(() => queryClient.invalidateQueries({ queryKey: ["album", QUIET.id] }));
  // The server restarting behind its proxy: the album stays, the failure is said over it.
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load");
  expect(title).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /Рассвет/ })).toBeInTheDocument();

  down = false;
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByRole("heading", { level: 1, name: "Тихие города" })).toBeInTheDocument();
});

test("an album deleted meanwhile says so when its page loads again", async () => {
  mockAccount();
  let gone = false;
  server.use(
    artist(),
    http.get(url(`/api/v1/albums/${QUIET.id}`), () =>
      gone ? apiError("album_not_found", 404) : HttpResponse.json(albumDetail(QUIET, TRACKS)),
    ),
  );
  const { queryClient } = renderSignedIn(`/albums/${QUIET.id}`);
  await screen.findByRole("heading", { level: 1, name: "Тихие города" });
  gone = true;
  await act(() => queryClient.invalidateQueries({ queryKey: ["album", QUIET.id] }));
  expect(await screen.findByRole("heading", { name: "Album not found." })).toBeInTheDocument();
});

test("a next page that fails isn't asked for again until asked", async () => {
  // A real observer reports the end of the list as visible at once: each failed page made
  // it observe again, and ask again, many times a second.
  class SeenObserver {
    constructor(private readonly report: IntersectionObserverCallback) {}
    observe() {
      this.report([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", SeenObserver);
  mockAccount();
  const all = Array.from({ length: 61 }, (_, i) => album(`Album ${i + 1}`, WIND));
  let down = true;
  const asked: number[] = [];
  server.use(
    http.get(url("/api/v1/albums"), ({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get("offset"));
      asked.push(offset);
      if (offset > 0 && down) return apiError("service_unavailable", 503);
      return HttpResponse.json(page(all.slice(offset, offset + 60), all.length, offset));
    }),
    http.get(url("/api/v1/genres"), () => HttpResponse.json([])),
  );
  const { user } = renderSignedIn("/albums");
  const retry = await screen.findByRole("button", { name: "Try again" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(asked).toEqual([0, 60]);
  // The list stays; the failure is said at its end, not over it.
  expect(screen.getAllByRole("article")).toHaveLength(60);
  expect(screen.getAllByRole("alert")).toHaveLength(1);
  expect(within(retry.parentElement!).getByRole("alert")).toHaveTextContent("Couldn't load");

  down = false;
  await user.click(retry);
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(61));
  expect(asked).toEqual([0, 60, 60]);
});

test('queries are asked again after no answer or a "not now", not after a "no"', () => {
  const retry = createQueryClient().getDefaultOptions().queries!.retry as (
    failures: number,
    error: unknown,
  ) => boolean;
  const failure = (status: number, headers?: HeadersInit) =>
    new ApiFailure(new Response(null, { status, headers }), null);
  expect(retry(0, new TypeError("Failed to fetch"))).toBe(true);
  for (const status of [502, 503, 504, 429]) expect(retry(0, failure(status))).toBe(true);
  for (const status of [400, 401, 403, 404, 422, 500])
    expect(retry(0, failure(status))).toBe(false);
  expect(retry(3, failure(503))).toBe(false);
  expect(retryDelay(1, failure(503))).toBe(2000);
  expect(retryDelay(1, failure(429, { "Retry-After": "7" }))).toBe(7000);
  expect(retryDelay(1, failure(429, { "Retry-After": "3600" }))).toBe(30_000);
});

test("a page that fails to render says so; the app and the player go on", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockAccount();
  const broken = { ...albumDetail(QUIET, TRACKS), tracks: null };
  server.use(
    artist(),
    http.get(url(`/api/v1/albums/${QUIET.id}`), () => HttpResponse.json(broken)),
    http.get(url("/api/v1/home"), () =>
      HttpResponse.json({ recently_added: [], for_you: [], recently_played: [], new_releases: [] }),
    ),
  );
  const { user } = renderSignedIn(`/albums/${QUIET.id}`);
  expect(await screen.findByText("Something went wrong on this page.")).toBeInTheDocument();
  expect(screen.getAllByRole("region", { name: "Player" }).length).toBeGreaterThan(0);
  // Another page renders again.
  await user.click(screen.getAllByRole("link", { name: "Home" })[0]!);
  expect(await screen.findByText("The library is empty")).toBeInTheDocument();
  expect(screen.queryByText("Something went wrong on this page.")).not.toBeInTheDocument();
});
