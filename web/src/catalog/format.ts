import type { Track } from "./queries";

/** A track's length as the player shows it: 3:07, 1:02:45. */
export function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  const [h, m, s] = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A codec's name as people know it: FLAC, MP3, Opus. */
export function codecName(codec: string): string {
  const names: Record<string, string> = { opus: "Opus", vorbis: "Vorbis" };
  return names[codec] ?? codec.toUpperCase();
}

/** A track's artists as text: "Северный Ветер, Анна Лунина". */
export function artistNames(track: Track): string {
  return (track.artists.length ? track.artists : [track.artist]).map((a) => a.name).join(", ");
}
