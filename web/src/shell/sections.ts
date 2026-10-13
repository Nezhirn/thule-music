import {
  Disc3,
  Heart,
  History,
  House,
  Library,
  MicVocal,
  Music,
  Search,
  Shield,
  Star,
  type LucideIcon,
} from "lucide-react";
import type { Messages } from "../i18n";

export type SectionId = keyof typeof SECTIONS;

/** The app's sections: where they live and their icon; names are in `t.nav`. */
export const SECTIONS = {
  home: { path: "/", icon: House },
  search: { path: "/search", icon: Search },
  library: { path: "/library", icon: Library },
  albums: { path: "/albums", icon: Disc3 },
  artists: { path: "/artists", icon: MicVocal },
  tracks: { path: "/tracks", icon: Music },
  liked: { path: "/liked", icon: Heart },
  favorites: { path: "/favorites", icon: Star },
  history: { path: "/history", icon: History },
  // Current on its subpages too (/admin/users).
  admin: { path: "/admin", icon: Shield, nested: true },
} satisfies Record<string, { path: string; icon: LucideIcon; nested?: boolean }>;

/** The sections in the library: a group in the sidebar, the library page on phones. */
export const LIBRARY_SECTIONS = [
  "albums",
  "artists",
  "tracks",
  "liked",
  "favorites",
  "history",
] as const;

export function sectionName(t: Messages, id: SectionId): string {
  return t.nav[id];
}
