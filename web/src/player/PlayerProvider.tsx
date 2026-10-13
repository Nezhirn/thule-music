import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import { preferencesQuery } from "../auth/queries";
import { useSession } from "../auth/session";
import { homeQuery } from "../catalog/queries";
import { PlayerContext } from "./context";
import { connectMediaSession } from "./mediaSession";
import { forgetSaved, keepSaved, loadSaved, loadVolume } from "./persist";
import { createPlayer, type AudioLike } from "./player";

/** The one player of the app, for the signed-in user. Restores the queue this device had,
 * paused; forgets it on signing out. `audio` is for tests: a fake element. */
export function PlayerProvider({ children, audio }: { children: ReactNode; audio?: AudioLike }) {
  const queryClient = useQueryClient();
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const quality = useQuery({ ...preferencesQuery, enabled: signedIn }).data?.stream_quality;

  const [player] = useState(() => {
    const created = createPlayer({
      audio: audio ?? new Audio(),
      streamUrl: (trackId, quality) =>
        unwrap(
          api.GET("/api/v1/tracks/{track_id}/stream-url", {
            params: { path: { track_id: trackId }, query: { quality } },
          }),
        ),
      async scrobble(trackId, listenedMs) {
        await unwrap(
          api.POST("/api/v1/me/plays", { body: { track_id: trackId, listened_ms: listenedMs } }),
        );
        // "Recently played" on the home page.
        void queryClient.invalidateQueries({ queryKey: homeQuery.queryKey });
      },
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
      return;
    }
    if (!signedIn) return;
    const saved = loadSaved();
    if (saved && player.store.getState().queue.items.length === 0) player.restore(saved);
    const stopSaving = keepSaved(player);
    const disconnect = connectMediaSession(player);
    return () => {
      stopSaving();
      disconnect();
    };
  }, [player, status, signedIn]);

  // A quality picked in the settings applies to the playing track at once.
  useEffect(() => {
    if (quality) player.applyQuality();
  }, [player, quality]);

  useEffect(() => () => player.pause(), [player]);

  return <PlayerContext value={player}>{children}</PlayerContext>;
}
