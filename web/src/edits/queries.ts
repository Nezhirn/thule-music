import { queryOptions, useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, type Schemas } from "../api/client";
import { errorMessage, unwrap } from "../api/errors";
import type { Album, Artist, Track } from "../catalog/queries";
import { lyricsQuery, type Lyrics } from "../lyrics/queries";
import { useI18n } from "../i18n";
import { usePlayerControls } from "../player/context";
import type { Player } from "../player/player";
import { announce } from "../ui/toast";
import type { GenreSubject } from "./context";

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

/** After the library changed: whatever shows albums, tracks or artists, covers included
 * (lists, pages, playlists' mosaics, search, the library's numbers). */
export function libraryEdited(queryClient: QueryClient) {
  for (const key of [
    ["home"],
    ["genres"],
    ["albums"],
    ["album"],
    ["artists"],
    ["artist"],
    ["tracks"],
    ["search"],
    ["playlists"],
    ["likes"],
    ["history"],
    ["admin", "stats"],
  ]) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

/** The queued tracks `pick` chooses, as the server has them now: changed, or out of the
 * queue when deleted. */
async function refreshQueued(player: Player, pick: (track: Track) => boolean) {
  const ids = new Set(
    player.store
      .getState()
      .queue.items.map((item) => item.track)
      .filter(pick)
      .map((track) => track.id),
  );
  const gone: string[] = [];
  await Promise.all(
    [...ids].map(async (id) => {
      const { data, response } = await api.GET("/api/v1/tracks/{track_id}", {
        params: { path: { track_id: id } },
      });
      if (data) player.updateTrack(id, data);
      else if (response.status === 404) gone.push(id);
    }),
  );
  if (gone.length) player.removeTracks(gone);
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
      libraryEdited(queryClient);
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
      libraryEdited(queryClient);
      announce(t.edits.cover.changed(track.title));
      player.updateTrack(track.id, { cover_id, cover_palette });
    },
  });
}

export function useUpdateAlbum(album: Album) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: (body: Schemas["AlbumPatch"]) =>
      unwrap(
        api.PATCH("/api/v1/albums/{album_id}", {
          params: { path: { album_id: album.id } },
          body,
        }),
      ),
    onSuccess: (saved) => {
      libraryEdited(queryClient);
      void refreshQueued(player, (track) => track.album.id === album.id);
      announce((saved.id === album.id ? t.edits.album.saved : t.edits.album.merged)(saved.title));
    },
  });
}

export function useDeleteAlbum(album: Album) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: (tracks: Schemas["AlbumDeletion"]) =>
      unwrap(
        api.DELETE("/api/v1/albums/{album_id}", {
          params: { path: { album_id: album.id }, query: { tracks } },
        }),
      ),
    onSuccess: (_, tracks) => {
      queryClient.removeQueries({ queryKey: ["album", album.id] });
      libraryEdited(queryClient);
      void refreshQueued(player, (track) => track.album.id === album.id);
      const text = t.edits.deleteAlbumDialog;
      announce((tracks === "delete" ? text.deleted : text.madeSingles)(album.title));
    },
    onError: (error) => announce(errorMessage(t, error)),
  });
}

export function useUpdateTrack(track: Track) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: (body: Schemas["TrackPatch"]) =>
      unwrap(
        api.PATCH("/api/v1/tracks/{track_id}", {
          params: { path: { track_id: track.id } },
          body,
        }),
      ),
    onSuccess: (saved) => {
      libraryEdited(queryClient);
      player.updateTrack(saved.id, saved);
      announce(t.edits.track.saved(saved.title));
    },
  });
}

export function useDeleteTrack(track: Track) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: () =>
      unwrap(api.DELETE("/api/v1/tracks/{track_id}", { params: { path: { track_id: track.id } } })),
    onSuccess: () => {
      libraryEdited(queryClient);
      player.removeTracks([track.id]);
      announce(t.edits.deleteTrackDialog.deleted(track.title));
    },
    onError: (error) => announce(errorMessage(t, error)),
  });
}

export function useMoveTracks() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: (body: Schemas["TrackMove"]) => unwrap(api.POST("/api/v1/tracks/move", { body })),
    onSuccess: (album, { track_ids }) => {
      libraryEdited(queryClient);
      void refreshQueued(player, (track) => track_ids.includes(track.id));
      announce(t.edits.move.moved(track_ids.length, album.title));
    },
  });
}

export function useRenameArtist(artist: Pick<Artist, "id" | "name">) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(
        api.PATCH("/api/v1/artists/{artist_id}", {
          params: { path: { artist_id: artist.id } },
          body: { name },
        }),
      ),
    onSuccess: (saved) => {
      libraryEdited(queryClient);
      void refreshQueued(
        player,
        (track) =>
          track.album_artist.id === artist.id || track.artists.some((a) => a.id === artist.id),
      );
      const text = t.edits.artist;
      announce((saved.id === artist.id ? text.renamed : text.merged)(saved.name));
    },
  });
}

export function useArtistCover(artist: Pick<Artist, "id" | "name">) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (picture: Picture) => {
      const params = { path: { artist_id: artist.id } };
      return unwrap(
        picture
          ? api.PUT("/api/v1/artists/{artist_id}/cover", { params, ...form(picture) })
          : api.DELETE("/api/v1/artists/{artist_id}/cover", { params }),
      );
    },
    onSuccess: () => {
      libraryEdited(queryClient);
      announce(t.edits.cover.changed(artist.name));
    },
  });
}

/** Deletes the artist with the files of their tracks; those of others featuring them lose
 * their name. */
export function useDeleteArtist(artist: Pick<Artist, "id" | "name">) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.DELETE("/api/v1/artists/{artist_id}", { params: { path: { artist_id: artist.id } } }),
      ),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["artist", artist.id] });
      libraryEdited(queryClient);
      void refreshQueued(
        player,
        (track) =>
          track.album_artist.id === artist.id || track.artists.some((a) => a.id === artist.id),
      );
      announce(t.edits.deleteArtistDialog.deleted(artist.name));
    },
  });
}

/** Gives albums to another artist. */
export function useMoveAlbums() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: (body: Schemas["AlbumsMove"]) => unwrap(api.POST("/api/v1/albums/move", { body })),
    onSuccess: (artist, { album_ids }) => {
      libraryEdited(queryClient);
      void refreshQueued(player, (track) => album_ids.includes(track.album.id));
      announce(t.edits.moveAlbumsDialog.movedToArtist(album_ids.length, artist.name));
    },
  });
}

/** Moves albums into a genre. */
export function useSetAlbumsGenre() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["AlbumsGenre"]) =>
      unwrap(api.POST("/api/v1/albums/genre", { body })),
    onSuccess: (genre, { album_ids }) => {
      libraryEdited(queryClient);
      announce(t.edits.moveAlbumsDialog.movedToGenre(album_ids.length, genre.name));
    },
  });
}

/** Most albums the server gives at once. */
const ALBUMS_PAGE = 200;

/** All the albums of a genre, by title. */
export const genreAlbumsQuery = (genre: string) =>
  queryOptions({
    queryKey: ["albums", "genre", genre],
    queryFn: async () => {
      const albums: Album[] = [];
      for (;;) {
        const page = await unwrap(
          api.GET("/api/v1/albums", {
            params: {
              query: { genre, sort: "title", limit: ALBUMS_PAGE, offset: albums.length },
            },
          }),
        );
        albums.push(...page.items);
        if (page.items.length === 0 || albums.length >= page.total) return albums;
      }
    },
  });

export function useRenameGenre(genre: GenreSubject) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      unwrap(
        api.PATCH("/api/v1/genres", { params: { query: { genre: genre.name } }, body: { name } }),
      ),
    onSuccess: (saved) => {
      libraryEdited(queryClient);
      const text = t.edits.genre;
      // More albums than it had: another genre's joined it.
      announce((saved.album_count > genre.albumCount ? text.merged : text.renamed)(saved.name));
    },
  });
}

/** Takes the genre off its albums, or deletes them with their files. */
export function useDeleteGenre(genre: GenreSubject) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  return useMutation({
    mutationFn: async (albums: Schemas["GenreDeletion"]) => {
      // The albums whose tracks leave the queue.
      const gone =
        albums === "delete"
          ? (await queryClient.fetchQuery(genreAlbumsQuery(genre.name))).map((a) => a.id)
          : [];
      await unwrap(
        api.DELETE("/api/v1/genres", { params: { query: { genre: genre.name, albums } } }),
      );
      return gone;
    },
    onSuccess: (gone, albums) => {
      libraryEdited(queryClient);
      if (gone.length) void refreshQueued(player, (track) => gone.includes(track.album.id));
      const text = t.edits.deleteGenreDialog;
      announce((albums === "delete" ? text.deleted : text.removed)(genre.name));
    },
  });
}
