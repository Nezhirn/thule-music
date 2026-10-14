import type { Player } from "./player";

// This tab, among the app's tabs in this browser.
const TAB = Math.random().toString(36).slice(2);

/** Two tabs of the app don't play at once: one starting to play pauses the others. Returns
 * the disconnect. `tab` and `now` are for tests: two "tabs" in one page, one clock. */
export function playOneTabAtATime(
  player: Player,
  tab = TAB,
  now: () => number = Date.now,
): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel("thule.player");
  // When this tab started playing: a message from a tab that started before, arriving
  // late, doesn't pause it. Two starting in the same millisecond agree by their names on
  // which plays on, so they don't pause each other.
  let since = 0;
  channel.onmessage = (event: MessageEvent<{ playing?: string; at?: number }>) => {
    const { playing, at = 0 } = event.data;
    if (!playing || playing === tab || !player.store.getState().playing) return;
    if (at > since || (at === since && playing > tab)) player.pause();
  };
  const unsubscribe = player.store.subscribe((state, previous) => {
    if (state.playing && !previous.playing) {
      since = now();
      channel.postMessage({ playing: tab, at: since });
    }
  });
  return () => {
    unsubscribe();
    channel.close();
  };
}
