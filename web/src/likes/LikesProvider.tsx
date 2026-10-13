import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import { useSession } from "../auth/session";
import { usePlayerControls } from "../player/context";
import { LikesContext } from "./context";
import { createLikes, type LikeKind } from "./likes";

/** Likes and favourites of the signed-in user, as changed on this device; forgotten on
 * signing out. */
export function LikesProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  const { status } = useSession();
  const [likes] = useState(() =>
    createLikes({
      send,
      changed(kind, id, liked) {
        // The queue kept on the device remembers it over a reload.
        if (kind === "track") player.updateTrack(id, { liked });
      },
      saved(kind) {
        // Liked songs, Favourites.
        void queryClient.invalidateQueries({ queryKey: ["likes", kind] });
      },
    }),
  );

  useEffect(() => {
    if (status === "anonymous") likes.reset();
  }, [likes, status]);

  return <LikesContext value={likes}>{children}</LikesContext>;
}

async function send(kind: LikeKind, id: string, liked: boolean): Promise<void> {
  if (kind === "track") {
    const params = { path: { track_id: id } };
    await unwrap(
      liked
        ? api.PUT("/api/v1/me/likes/tracks/{track_id}", { params })
        : api.DELETE("/api/v1/me/likes/tracks/{track_id}", { params }),
    );
  } else if (kind === "album") {
    const params = { path: { album_id: id } };
    await unwrap(
      liked
        ? api.PUT("/api/v1/me/likes/albums/{album_id}", { params })
        : api.DELETE("/api/v1/me/likes/albums/{album_id}", { params }),
    );
  } else {
    const params = { path: { artist_id: id } };
    await unwrap(
      liked
        ? api.PUT("/api/v1/me/likes/artists/{artist_id}", { params })
        : api.DELETE("/api/v1/me/likes/artists/{artist_id}", { params }),
    );
  }
}
