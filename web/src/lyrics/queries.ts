import { queryOptions } from "@tanstack/react-query";
import { api, type Schemas } from "../api/client";
import { ApiFailure, unwrap } from "../api/errors";

export type Lyrics = Schemas["LyricsOut"];

/** A track's lyrics; null when it has none (`lyrics_not_found`). Lyrics are found once,
 * when the track is imported or its lyrics file changes: no need to ask again often. */
export const lyricsQuery = (trackId: string) =>
  queryOptions({
    queryKey: ["lyrics", trackId],
    queryFn: async (): Promise<Lyrics | null> => {
      try {
        return await unwrap(
          api.GET("/api/v1/tracks/{track_id}/lyrics", {
            params: { path: { track_id: trackId } },
          }),
        );
      } catch (error) {
        if (error instanceof ApiFailure && error.code === "lyrics_not_found") return null;
        throw error;
      }
    },
    staleTime: 10 * 60_000,
  });

/** The words as stanzas of lines: the plain text, or the timed lines without their times.
 * Empty when there are none. */
export function stanzas(lyrics: Lyrics): string[][] {
  const text = lyrics.plain ?? lyrics.lines.map((line) => line.text).join("\n");
  return text
    .split(/\n\s*\n/)
    .map((stanza) =>
      stanza
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .filter((stanza) => stanza.length > 0);
}
