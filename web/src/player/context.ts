import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { Player, PlayerState, Source } from "./player";
import { currentItem } from "./queue";

export const PlayerContext = createContext<Player | null>(null);

/** The player's commands. Stable. */
export function usePlayerControls(): Player {
  const player = useContext(PlayerContext);
  if (!player) throw new Error("usePlayerControls outside PlayerProvider");
  return player;
}

/** A part of the player's state; the component renders again when it changes. The selector
 * must return the same value for the same state (no new objects). */
export function usePlayer<T>(select: (state: PlayerState) => T): T {
  return useStore(usePlayerControls().store, select);
}

export const selectCurrent = (state: PlayerState) => currentItem(state.queue);
export const selectTrack = (state: PlayerState) => currentItem(state.queue)?.track ?? null;

/** Whether the queue came from `source` and plays. */
export function usePlayingSource(source: Source): boolean {
  return usePlayer(
    (state) => state.playing && state.source?.type === source.type && state.source.id === source.id,
  );
}
