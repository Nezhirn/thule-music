import { createAlbumUploads } from "./albumUploads";

test("a file can be cancelled while it is sent or waits; the rest go on", async () => {
  const signals = new Map<string, AbortSignal>();
  const uploads = createAlbumUploads({
    send: (_target, file, _progress, signal) => {
      signals.set(file.name, signal);
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new DOMException("stop", "AbortError"))),
      );
    },
  });
  const target = { kind: "album", albumId: "a" } as const;
  uploads.add(
    target,
    ["a.mp3", "b.mp3", "c.mp3"].map((name) => new File(["x"], name)),
  );
  const names = () => uploads.store.getState().items.map((item) => item.file.name);
  const [a, b] = uploads.store.getState().items;
  uploads.cancel(b!.id); // waiting
  uploads.cancel(a!.id); // being sent
  expect(signals.get("a.mp3")?.aborted).toBe(true);
  expect(names()).toEqual(["c.mp3"]);
  await vi.waitFor(() => expect(signals.has("c.mp3")).toBe(true));
  expect(signals.has("b.mp3")).toBe(false);
  expect(uploads.store.getState().items[0]?.state.stage).toBe("sending");
});
