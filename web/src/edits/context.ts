import { createContext, useContext } from "react";
import type { Schemas } from "../api/client";
import type { Album, Track } from "../catalog/queries";
import type { AlbumUploads } from "./albumUploads";

/** What a cover is changed for: an album (with whether an admin chose its cover), or a
 * track's own picture. */
export type CoverSubject =
  { kind: "album"; album: Album & { cover_custom?: boolean } } | { kind: "track"; track: Track };

/** Tracks to move: those to choose from, and those chosen to begin with. */
export interface MoveSubject {
  tracks: Track[];
  selected: string[];
}

export interface Edits {
  editLyrics(track: Track): void;
  editCover(subject: CoverSubject): void;
  editAlbum(album: Album): void;
  uploadToAlbum(album: Album): void;
  deleteAlbum(album: Album, tracks: Track[]): void;
  editTrack(track: Track): void;
  moveTracks(subject: MoveSubject): void;
  deleteTrack(track: Track): void;
  renameArtist(artist: Schemas["ArtistRef"]): void;
  uploads: AlbumUploads;
}

export const EditsContext = createContext<Edits | null>(null);

/** Opens the admins' dialogs that manage the library: lyrics, covers, albums, tracks,
 * artists. Null for everyone else, who gets no such menu items. */
export function useEdits(): Edits | null {
  return useContext(EditsContext);
}
