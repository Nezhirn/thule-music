// A stand-in for the <audio> element, which jsdom doesn't play. It changes state and sends
// events the way a browser does: play() and pause() change state at once and send their
// events a moment later (a browser queues them), the rest only when a test says so, with
// `start`, `advance`, `finish` and `fail`.
import type { AudioLike } from "../player/player";

export class FakeAudio extends EventTarget {
  #src = "";
  currentTime = 0;
  duration = Number.NaN;
  paused = true;
  ended = false;
  volume = 1;
  muted = false;
  preload: "" | "none" | "metadata" | "auto" = "";
  /** What play() does; a test can make it reject (autoplay blocked). */
  playResult: () => Promise<void> = () => Promise.resolve();
  /** Whether the "browser" plays Ogg Opus. */
  opus = true;

  get src() {
    return this.#src;
  }

  /** A new source starts over, paused, as the element's load algorithm does (no events). */
  set src(value: string) {
    this.#src = value;
    this.currentTime = 0;
    this.duration = Number.NaN;
    this.paused = true;
    this.ended = false;
  }

  play(): Promise<void> {
    if (this.paused) {
      this.paused = false;
      this.ended = false;
      this.later("play");
    }
    return this.playResult();
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.later("timeupdate", "pause");
  }

  canPlayType(type: string): CanPlayTypeResult {
    return this.opus || !type.includes("opus") ? "probably" : "";
  }

  removeAttribute(name: string) {
    if (name === "src") this.#src = "";
  }

  load() {
    this.currentTime = 0;
  }

  emit(type: string) {
    this.dispatchEvent(new Event(type));
  }

  /** Sends the events after the code that caused them has run, as a browser does. A new
   * source drops them, as the load algorithm does. */
  private later(...types: string[]) {
    const src = this.#src;
    queueMicrotask(() => {
      if (this.#src === src) for (const type of types) this.emit(type);
    });
  }

  /** The stream starts: its length is known and sound comes out. */
  start(duration: number) {
    this.duration = duration;
    this.emit("durationchange");
    this.emit("playing");
  }

  /** Plays on to `seconds`, in time updates of a quarter second as a browser sends them. */
  advance(seconds: number) {
    while (this.currentTime < seconds) {
      this.currentTime = Math.min(seconds, this.currentTime + 0.25);
      this.emit("timeupdate");
    }
  }

  /** Plays to the end. */
  finish() {
    this.advance(this.duration);
    this.paused = true;
    this.ended = true;
    this.emit("pause");
    this.emit("ended");
  }

  /** The stream breaks (an expired URL, a network error). */
  fail() {
    this.paused = true;
    this.emit("error");
  }

  asAudio(): AudioLike {
    return this as unknown as AudioLike;
  }
}
