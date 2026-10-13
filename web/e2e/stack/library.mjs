// Generates the E2E music library from library.json with ffmpeg: one folder per album, sine
// tones with full tags, covers as a folder image or embedded in the files. Kept between runs
// and rebuilt only when the spec or this generator changes.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * @typedef {{
 *   artist: string, title: string, year: number, genre: string,
 *   format: keyof typeof CODECS,
 *   cover: { in: "folder" | "file", color: string } | null,
 *   tracks: string[],
 * }} AlbumSpec
 */

/** Seconds of each track: distinct, so tracks differ in duration too. */
const trackSeconds = (/** @type {number} */ index) => 20 + 5 * index;

const CODECS = {
  flac: ["-c:a", "flac"],
  mp3: ["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3"],
  ogg: ["-c:a", "libvorbis", "-q:a", "3"],
  m4a: ["-c:a", "aac", "-b:a", "128k"],
};

const ffmpeg = (/** @type {string[]} */ args) =>
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);

/** @param {string} path @param {string} color */
async function makeCover(path, color) {
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    `color=c=0x${color.slice(1)}:s=600x600`,
    "-frames:v",
    "1",
    path,
  ]);
}

/**
 * @param {string} path @param {AlbumSpec} album @param {number} index
 * @param {string | undefined} coverPath
 */
async function makeTrack(path, album, index, coverPath) {
  const title = album.tracks[index];
  const input = [
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=${220 * 2 ** (index / 12)}:duration=${trackSeconds(index)}`,
  ];
  const picture = coverPath
    ? [
        "-i",
        coverPath,
        "-map",
        "0:a",
        "-map",
        "1:v",
        "-c:v",
        "copy",
        "-disposition:v:0",
        "attached_pic",
      ]
    : [];
  const tags = {
    title,
    artist: album.artist,
    album_artist: album.artist,
    album: album.title,
    date: String(album.year),
    genre: album.genre,
    track: `${index + 1}/${album.tracks.length}`,
  };
  const metadata = Object.entries(tags).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]);
  await ffmpeg([...input, ...picture, ...CODECS[album.format], ...metadata, path]);
}

/** @param {string} root */
export async function generateLibrary(root) {
  const specPath = new URL("library.json", import.meta.url);
  const spec = await readFile(specPath, "utf8");
  const fingerprint = createHash("sha256")
    .update(spec)
    .update(await readFile(new URL(import.meta.url)))
    .digest("hex");
  const stamp = join(root, ".fingerprint");
  if ((await readFile(stamp, "utf8").catch(() => "")) === fingerprint) return;

  await rm(root, { recursive: true, force: true });
  const scratch = join(root, ".covers");
  await mkdir(scratch, { recursive: true });
  /** @type {{ albums: AlbumSpec[] }} */
  const { albums } = JSON.parse(spec);
  await Promise.all(
    albums.map(async (album) => {
      const dir = join(root, album.artist, `${album.year} - ${album.title}`);
      await mkdir(dir, { recursive: true });
      /** @type {string | undefined} */
      let embedded;
      if (album.cover?.in === "folder") await makeCover(join(dir, "cover.jpg"), album.cover.color);
      if (album.cover?.in === "file") {
        embedded = join(scratch, `${album.title}.jpg`);
        await makeCover(embedded, album.cover.color);
      }
      await Promise.all(
        album.tracks.map((title, i) => {
          const name = `${String(i + 1).padStart(2, "0")} ${title}.${album.format}`;
          return makeTrack(join(dir, name), album, i, embedded);
        }),
      );
    }),
  );
  // Not part of the library: the scan would only skip it, but keep the tree clean.
  await rm(scratch, { recursive: true });
  await writeFile(stamp, fingerprint);
}
