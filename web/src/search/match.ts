import type { Album, Artist, Track } from "../catalog/queries";

/** Text as search compares it: lower case, "ё" as "е", without accents ("Café" is "cafe"),
 * but "й" stays itself. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replaceAll("ё", "е")
    .normalize("NFD")
    .replace(/[̀-̅̇-ͯ]/g, "")
    .normalize("NFC");
}

/** What is searched for: spaces at the ends and runs of them dropped. */
export function clean(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** How well `name` answers `query`: 3 is the name itself, 2 its start, 1 the start of one of
 * its words, 0 anything else the server found (inside a word, a misspelling). */
export function closeness(name: string, query: string): number {
  const n = fold(name);
  const q = fold(query);
  if (n === q) return 3;
  if (n.startsWith(q)) return 2;
  if (n.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(q))) return 1;
  return 0;
}

export type TopResult =
  | { kind: "artist"; artist: Artist }
  | { kind: "album"; album: Album }
  | { kind: "track"; track: Track };

/** The best of the closest artist, album and track: the one whose name answers the query
 * best; on a tie an artist before an album before a track ("aurora" is the artist rather
 * than their song "Slow Aurora"). Albums and tracks found by their artist's name lose to
 * the artist. */
export function topResult(
  query: string,
  found: { artists: Artist[]; albums: Album[]; tracks: Track[] },
): TopResult | null {
  const candidates: [TopResult, string][] = [];
  const [artist] = found.artists;
  const [album] = found.albums;
  const [track] = found.tracks;
  if (artist) candidates.push([{ kind: "artist", artist }, artist.name]);
  if (album) candidates.push([{ kind: "album", album }, album.title]);
  if (track) candidates.push([{ kind: "track", track }, track.title]);
  let best: TopResult | null = null;
  let bestScore = -1;
  for (const [candidate, name] of candidates) {
    const score = closeness(name, query);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
