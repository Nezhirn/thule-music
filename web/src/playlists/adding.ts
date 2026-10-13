import { createContext, useContext } from "react";
import type { Track } from "../catalog/queries";

/** What goes into a playlist: tracks, and what to call them (a track's or album's title). */
export interface Adding {
  tracks: Track[];
  name: string;
}

export const AddContext = createContext<((adding: Adding) => void) | null>(null);

/** Opens "Add to playlist" for tracks. */
export function useAddToPlaylist(): (adding: Adding) => void {
  const open = useContext(AddContext);
  if (!open) throw new Error("useAddToPlaylist outside AddToPlaylistProvider");
  return open;
}
