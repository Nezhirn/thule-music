import { coverUrl } from "../api/covers";
import type { Track } from "../catalog/queries";
import { INITIAL_STATE, type Player, type PlayerState } from "./player";
import { currentItem } from "./queue";

/** Seconds the system's seek back / forward buttons move by, unless they say. */
const SEEK_OFFSET = 10;

function metadata(track: Track): MediaMetadata {
  const cover = track.album.cover_id;
  const artwork = cover
    ? ([300, 600] as const).map((size) => ({
        // Absolute: the system shows it outside the page.
        src: new URL(coverUrl(cover, size), location.href).href,
        sizes: `${size}x${size}`,
        type: "image/jpeg",
      }))
    : [];
  return new MediaMetadata({
    title: track.title,
    artist: (track.artists.length ? track.artists : [track.artist]).map((a) => a.name).join(", "),
    album: track.album.title,
    artwork,
  });
}

/** Shows what plays where the system shows media (lock screen, media keys, notifications)
 * and takes its commands. Returns the disconnect. */
export function connectMediaSession(
  player: Player,
  session: MediaSession | undefined = navigator.mediaSession,
): () => void {
  if (!session || typeof MediaMetadata === "undefined") return () => {};
  const position = () => player.store.getState().position;
  const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => player.resume()],
    ["pause", () => player.pause()],
    ["stop", () => player.pause()],
    ["previoustrack", () => player.previous()],
    ["nexttrack", () => player.next()],
    ["seekto", ({ seekTime }) => seekTime !== undefined && player.seek(seekTime)],
    ["seekbackward", ({ seekOffset }) => player.seek(position() - (seekOffset ?? SEEK_OFFSET))],
    ["seekforward", ({ seekOffset }) => player.seek(position() + (seekOffset ?? SEEK_OFFSET))],
  ];
  const handle = (on: boolean) => {
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, on ? handler : null);
      } catch {
        // An action this browser doesn't know.
      }
    }
  };
  handle(true);

  const update = (state: PlayerState, previous: PlayerState) => {
    const track = currentItem(state.queue)?.track ?? null;
    const changed = track !== (currentItem(previous.queue)?.track ?? null);
    if (changed) session.metadata = track ? metadata(track) : null;
    session.playbackState = track ? (state.playing ? "playing" : "paused") : "none";
    // The system moves the position on by itself while playing; it needs telling when the
    // track, its length or the playing state change, or the position jumps (a seek).
    const jumped = Math.abs(state.position - previous.position) > 1;
    if (
      track &&
      state.duration > 0 &&
      (changed ||
        jumped ||
        state.duration !== previous.duration ||
        state.playing !== previous.playing)
    ) {
      try {
        session.setPositionState({
          duration: state.duration,
          position: Math.min(Math.max(state.position, 0), state.duration),
          playbackRate: 1,
        });
      } catch {
        // Not supported.
      }
    }
  };
  // What is there already (a queue restored on start), then the changes.
  update(player.store.getState(), INITIAL_STATE);
  const unsubscribe = player.store.subscribe(update);
  return () => {
    unsubscribe();
    handle(false);
    session.metadata = null;
    session.playbackState = "none";
  };
}
