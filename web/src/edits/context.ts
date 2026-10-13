import { createContext, useContext } from "react";
import type { Schemas } from "../api/client";
import type { Album, Track } from "../catalog/queries";
import type { AlbumUploads } from "./albumUploads";

type ArtistDetail = Schemas["ArtistDetail"];

/** What a cover is changed for: an album (with whether an admin chose its cover), a track's
 * own picture, or an artist's. */
export type CoverSubject =
  | { kind: "album"; album: Album & { cover_custom?: boolean } }
  | { kind: "track"; track: Track }
  | { kind: "artist"; artist: ArtistDetail };

/** Tracks to move: those to choose from, and those chosen to begin with. */
export interface MoveSubject {
  tracks: Track[];
  selected: string[];
}

/** Albums to move: an artist's to another artist, or a genre's to another genre. */
export type AlbumsMoveSubject =
  { kind: "artist"; artist: ArtistDetail } | { kind: "genre"; genre: GenreSubject };

/** A genre as the albums list shows it: its name, and how many albums it has. */
export interface GenreSubject {
  name: string;
  albumCount: number;
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
  uploadToArtist(artist: Schemas["ArtistRef"]): void;
  moveAlbums(subject: AlbumsMoveSubject): void;
  deleteArtist(artist: ArtistDetail): void;
  renameGenre(genre: GenreSubject): void;
  deleteGenre(genre: GenreSubject): void;
  uploads: AlbumUploads;
}

export const EditsContext = createContext<Edits | null>(null);

/** Opens the admins' dialogs that manage the library: lyrics, covers, albums, tracks,
 * artists, genres. Null for everyone else, who gets no such menu items. */
export function useEdits(): Edits | null {
  return useContext(EditsContext);
}
