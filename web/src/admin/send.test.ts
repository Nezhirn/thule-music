import { sendFile } from "./send";

vi.mock("../auth/tokens", () => ({
  getAccessToken: async () => "access-1",
  renewAccessToken: async () => null,
}));

/** An XMLHttpRequest whose upload the test drives. */
class FakeXhr {
  static last: FakeXhr | null = null;
  upload: { onprogress?: (event: Partial<ProgressEvent>) => void; onload?: () => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  onloadend?: () => void;
  status = 0;
  responseText = "";
  constructor() {
    FakeXhr.last = this;
  }
  open() {}
  setRequestHeader() {}
  getResponseHeader() {
    return null;
  }
  send() {}
  abort() {
    this.onabort?.();
    this.onloadend?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
}

function start() {
  vi.useFakeTimers();
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  const progress: number[] = [];
  const outcome = sendFile(
    new File(["x"], "a.mp3"),
    "",
    (p) => progress.push(p),
    new AbortController().signal,
  ).then(
    () => "sent",
    (error: unknown) => error,
  );
  return { progress, outcome };
}

test("an upload sending nothing for a minute gives up, as if offline", async () => {
  const { outcome } = start();
  await vi.advanceTimersByTimeAsync(0);
  const xhr = FakeXhr.last!;
  await vi.advanceTimersByTimeAsync(50_000);
  xhr.progress(10, 100); // still going: the minute starts again
  await vi.advanceTimersByTimeAsync(50_000);
  xhr.progress(20, 100);
  await vi.advanceTimersByTimeAsync(60_000);
  const error = await outcome;
  expect(error).toBeInstanceOf(TypeError);
  expect((error as Error).message).toBe("The upload stalled");
});

test("once sent, the server has minutes to answer; progress is told a few times a second", async () => {
  const { progress, outcome } = start();
  await vi.advanceTimersByTimeAsync(0);
  const xhr = FakeXhr.last!;
  for (let i = 1; i <= 100; i++) {
    xhr.progress(i, 100);
    await vi.advanceTimersByTimeAsync(10);
  }
  // A second of progress events: four reports, and the last one.
  expect(progress.length).toBeLessThanOrEqual(6);
  expect(progress.at(-1)).toBe(1);
  xhr.upload.onload?.();
  await vi.advanceTimersByTimeAsync(4 * 60_000);
  xhr.status = 202;
  xhr.responseText = JSON.stringify([{ path: "uploads/a.mp3", duplicate: false }]);
  xhr.onload?.();
  xhr.onloadend?.();
  expect(await outcome).toBe("sent");
});
