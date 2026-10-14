import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import { preferencesQuery } from "../auth/queries";
import { useSession } from "../auth/session";
import { homeQuery } from "../catalog/queries";
import { historyQuery } from "../history/queries";
import { timeoutSignal } from "../lib/timeout";
import { PlayerContext } from "./context";
import { connectMediaSession } from "./mediaSession";
import { refreshLater } from "../queryClient";
import { forgetSaved, keepSaved, loadSaved, loadVolume } from "./persist";
import { createPlayer, type AudioLike } from "./player";
import { createScrobbler } from "./scrobbles";
import { playOneTabAtATime } from "./tabs";

// A stream URL or a play the server doesn't answer within this long (ms) is given up: the
// track stops instead of the play button spinning for ever, the play is kept for later.
const TIMEOUT_MS = 15_000;

/** The one player of the app, for the signed-in user. Restores the queue this device had,
 * paused; forgets it on signing out. `audio` is for tests: a fake element. */
export function PlayerProvider({ children, audio }: { children: ReactNode; audio?: AudioLike }) {
  const queryClient = useQueryClient();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const quality = useQuery({ ...preferencesQuery, enabled: signedIn }).data?.stream_quality;

  const [scrobbler] = useState(() =>
    createScrobbler(async (play) => {
      await unwrap(api.POST("/api/v1/me/plays", { body: play, signal: timeoutSignal(TIMEOUT_MS) }));
      // "Recently played" on the home page, and the history: shown fresh when next looked at.
      refreshLater(queryClient, homeQuery.queryKey);
      refreshLater(queryClient, historyQuery.queryKey);
    }),
  );
  const [player] = useState(() => {
    const created = createPlayer({
      audio: audio ?? new Audio(),
      streamUrl: (trackId, quality) =>
        unwrap(
          api.GET("/api/v1/tracks/{track_id}/stream-url", {
            params: { path: { track_id: trackId }, query: { quality } },
            signal: timeoutSignal(TIMEOUT_MS),
          }),
        ),
      scrobble: (trackId, listenedMs, playedAt) =>
        scrobbler.record({ track_id: trackId, listened_ms: listenedMs, played_at: playedAt }),
      quality: () => queryClient.getQueryData(preferencesQuery.queryKey)?.stream_quality ?? "high",
    });
    const volume = loadVolume();
    if (volume) {
      created.setVolume(volume.volume);
      created.setMuted(volume.muted);
    }
    return created;
  });

  useEffect(() => {
    if (status === "anonymous") {
      player.reset();
      forgetSaved();
      scrobbler.forget();
      return;
    }
    if (!signedIn) return;
    const saved = loadSaved();
    if (saved && player.store.getState().queue.items.length === 0) player.restore(saved);
    const stopSaving = keepSaved(player);
    const disconnect = connectMediaSession(player);
    const stopSharing = playOneTabAtATime(player);
    // Plays kept while the server couldn't be reached, and a track that stopped for it.
    void scrobbler.flush();
    const online = () => {
      void scrobbler.flush();
      player.retryStalled();
    };
    window.addEventListener("online", online);
    return () => {
      stopSaving();
      disconnect();
      stopSharing();
      window.removeEventListener("online", online);
    };
  }, [player, scrobbler, status, signedIn]);

  // A quality picked in the settings applies to the playing track at once.
  useEffect(() => {
    if (quality) player.applyQuality();
  }, [player, quality]);

  useEffect(() => () => player.pause(), [player]);

  return <PlayerContext value={player}>{children}</PlayerContext>;
}
