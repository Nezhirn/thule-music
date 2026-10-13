import { createContext, useCallback, useContext } from "react";
import { useStore } from "zustand";
import { errorMessage } from "../api/errors";
import { useI18n, type Messages } from "../i18n";
import { announce } from "../ui/toast";
import type { LikeKind, Likes } from "./likes";

export const LikesContext = createContext<Likes | null>(null);

/** Something that can be liked, with its like as loaded. */
export interface Likeable {
  id: string;
  liked: boolean;
}

function useLikes(): Likes {
  const likes = useContext(LikesContext);
  if (!likes) throw new Error("useLikes outside LikesProvider");
  return likes;
}

/** Whether `item` is liked: as changed on this device, or as loaded. */
export function useLiked(kind: LikeKind, item: Likeable): boolean {
  const changed = useStore(useLikes().store, (state) => state[kind][item.id]);
  return changed ?? item.liked;
}

/** Likes or unlikes `item` (`name` is for the message saying so). */
export function useToggleLike(): (kind: LikeKind, item: Likeable, name: string) => void {
  const likes = useLikes();
  const { t } = useI18n();
  return useCallback(
    (kind, item, name) => {
      const was = likes.store.getState()[kind][item.id] ?? item.liked;
      announce(message(t, kind, !was, name));
      likes.set(kind, item.id, !was, was).catch((error: unknown) => {
        announce(t.settings.saveFailed(errorMessage(t, error)));
      });
    },
    [likes, t],
  );
}

function message(t: Messages, kind: LikeKind, liked: boolean, name: string): string {
  if (kind === "track") return liked ? t.likes.liked(name) : t.likes.unliked(name);
  return liked ? t.likes.favourited(name) : t.likes.unfavourited(name);
}
