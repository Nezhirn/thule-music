import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { errorMessage, unwrap } from "../api/errors";
import type { Album, Track } from "../catalog/queries";
import { lyricsQuery, type Lyrics } from "../lyrics/queries";
import { useI18n } from "../i18n";
import { usePlayerControls } from "../player/context";
import { announce } from "../ui/toast";

/** The server's limit for a cover. */
export const MAX_COVER_BYTES = 20 * 1024 * 1024;

/** After the words are given up, how long to wait before each look at whether the server
 * found new ones (ms): the lookup runs in the background, LRCLIB may take seconds. */
const LOOK_AGAIN = [1000, 1500, 2500, 4000, 6000];

export function useSaveLyrics(track: Track) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { text: string; instrumental: boolean }) =>
      unwrap(
        api.PUT("/api/v1/tracks/{track_id}/lyrics", {
          params: { path: { track_id: track.id } },
          body,
        }),
      ),
    onSuccess: (lyrics) => {
      queryClient.setQueryData(lyricsQuery(track.id).queryKey, lyrics);
      announce((lyrics ? t.edits.lyrics.saved : t.edits.lyrics.removed)(track.title));
    },
  });
}

/** Gives up the track's lyrics and waits for the server to find them again. Resolves with
 * them, or null when none were found in time. */
export function useFindLyricsAgain(track: Track) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (): Promise<Lyrics | null> => {
      await unwrap(
        api.DELETE("/api/v1/tracks/{track_id}/lyrics", {
          params: { path: { track_id: track.id } },
        }),
      );
      const query = lyricsQuery(track.id);
      queryClient.setQueryData(query.queryKey, null);
      for (const delay of LOOK_AGAIN) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const found = await queryClient.fetchQuery({ ...query, staleTime: 0 });
        if (found) return found;
      }
      return null;
    },
    onSuccess: (found) =>
      announce((found ? t.edits.lyrics.found : t.edits.lyrics.notFound)(track.title)),
    onError: (error) => announce(errorMessage(t, error)),
  });
}

/** A cover on the way: an image, or null to give up the admin's choice. */
type Picture = File | null;

function form(file: File) {
  return {
    // The generated type says string for a binary field; the serializer sends the file.
    body: { file: file as unknown as string },
    bodySerializer: () => {
      const data = new FormData();
      data.append("file", file);
      return data;
    },
  };
}

/** Covers show up all over: lists, pages, playlists' mosaics, search. */
function coversChanged(queryClient: QueryClient) {
  for (const key of [
    ["home"],
    ["albums"],
    ["album"],
    ["artists"],
    ["artist"],
    ["tracks"],
    ["search"],
    ["playlists"],
    ["likes"],
    ["history"],
  ]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

export function useAlbumCover(album: Album) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: (picture: Picture) => {
      const params = { path: { album_id: album.id } };
      return unwrap(
        picture
          ? api.PUT("/api/v1/albums/{album_id}/cover", { params, ...form(picture) })
          : api.DELETE("/api/v1/albums/{album_id}/cover", { params }),
      );
    },
    onSuccess: ({ cover_id, cover_palette }) => {
      coversChanged(queryClient);
      announce(t.edits.cover.changed(album.title));
      // Queued tracks of the album; those showing its cover show the new one.
      player.updateTracks((track) => {
        if (track.album.id !== album.id) return null;
        const own = track.cover_id !== track.album.cover_id;
        return {
          album: { ...track.album, cover_id, cover_palette },
          ...(!own && { cover_id, cover_palette }),
        };
      });
    },
  });
}

export function useTrackCover(track: Track) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: (picture: Picture) => {
      const params = { path: { track_id: track.id } };
      return unwrap(
        picture
          ? api.PUT("/api/v1/tracks/{track_id}/cover", { params, ...form(picture) })
          : api.DELETE("/api/v1/tracks/{track_id}/cover", { params }),
      );
    },
    onSuccess: ({ cover_id, cover_palette }) => {
      coversChanged(queryClient);
      announce(t.edits.cover.changed(track.title));
      player.updateTrack(track.id, { cover_id, cover_palette });
    },
  });
}
