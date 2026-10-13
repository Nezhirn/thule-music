import { createContext, useContext } from "react";
import type { Album, Track } from "../catalog/queries";

/** What a cover is changed for: an album (with whether an admin chose its cover), or a
 * track's own picture. */
export type CoverSubject =
  { kind: "album"; album: Album & { cover_custom?: boolean } } | { kind: "track"; track: Track };

export interface Edits {
  editLyrics(track: Track): void;
  editCover(subject: CoverSubject): void;
}

export const EditsContext = createContext<Edits | null>(null);

/** Opens the admins' dialogs that correct lyrics and covers; null for everyone else, who
 * gets no such menu items. */
export function useEdits(): Edits | null {
  return useContext(EditsContext);
}
