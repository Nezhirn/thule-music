// Generates the E2E music library from library.json with ffmpeg: one folder per album (with
// CD1, CD2... inside for several discs), sine tones with full tags, covers as a folder image or
// embedded in the files. Kept between runs and rebuilt when the spec or this generator
// changes, or when its files did (the admin tests rename, move and delete them).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/**
 * A track is its title, or its title with its own artist (a guest, a compilation's artists)
 * and lyrics: in a .lrc file beside it (`lrc`) or in its tags (`lyrics`).
 * @typedef {string | { title: string, artist?: string, lrc?: string, lyrics?: string }} TrackSpec
 * @typedef {{
 *   artist: string, title: string, year: number, genre: string,
 *   format: keyof typeof CODECS,
 *   cover: { in: "folder" | "file", color: string } | null,
 *   tracks: TrackSpec[],
 *   discs?: number,
 * }} AlbumSpec
 */

/** Disc and number on it of the album's `index`-th track: discs split the tracks evenly. */
function position(/** @type {AlbumSpec} */ album, /** @type {number} */ index) {
  const perDisc = Math.ceil(album.tracks.length / (album.discs ?? 1));
  return { disc: Math.floor(index / perDisc) + 1, number: (index % perDisc) + 1, perDisc };
}

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
export async function makeCover(path, color) {
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
  const spec = /** @type {TrackSpec} */ (album.tracks[index]);
  const {
    title,
    artist = album.artist,
    lyrics,
  } = typeof spec === "string" ? { title: spec } : spec;
  const { disc, number, perDisc } = position(album, index);
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
    artist,
    album_artist: album.artist,
    album: album.title,
    date: String(album.year),
    genre: album.genre,
    track: `${number}/${perDisc}`,
    ...(album.discs ? { disc: `${disc}/${album.discs}` } : {}),
    ...(lyrics ? { lyrics } : {}),
  };
  const metadata = Object.entries(tags).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]);
  await ffmpeg([...input, ...picture, ...CODECS[album.format], ...metadata, path]);
}

/**
 * Writes an album's files into `dir`: its tracks (in CD1, CD2... for several discs), their
 * .lrc lyrics and its cover. `scratch` is for a cover to embed.
 * @param {string} dir @param {AlbumSpec} album @param {string} scratch
 */
export async function writeAlbum(dir, album, scratch) {
  await mkdir(dir, { recursive: true });
  /** @type {string | undefined} */
  let embedded;
  if (album.cover?.in === "folder") await makeCover(join(dir, "cover.jpg"), album.cover.color);
  if (album.cover?.in === "file") {
    await mkdir(scratch, { recursive: true });
    embedded = join(scratch, `${album.title}.jpg`);
    await makeCover(embedded, album.cover.color);
  }
  await Promise.all(
    album.tracks.map(async (spec, i) => {
      const title = typeof spec === "string" ? spec : spec.title;
      const { disc, number } = position(album, i);
      const folder = album.discs ? join(dir, `CD${disc}`) : dir;
      await mkdir(folder, { recursive: true });
      const name = `${String(number).padStart(2, "0")} ${title}`;
      if (typeof spec !== "string" && spec.lrc) {
        await writeFile(join(folder, `${name}.lrc`), spec.lrc);
      }
      return makeTrack(join(folder, `${name}.${album.format}`), album, i, embedded);
    }),
  );
}

/**
 * Every file of the library but the uploads (removed at each start) and the stamp, with its
 * size and time: whether the library is still as generated.
 * @param {string} root
 */
async function snapshot(root) {
  const lines = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = relative(root, join(entry.parentPath, entry.name));
    if (path === ".fingerprint" || path.startsWith("uploads/")) continue;
    const { size, mtimeMs } = await stat(join(root, path));
    lines.push(`${path} ${size} ${Math.round(mtimeMs)}`);
  }
  return lines.sort().join("\n");
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
  const stamped = await readFile(stamp, "utf8").catch(() => "");
  if (stamped && stamped === `${fingerprint}\n${await snapshot(root)}`) return;

  await rm(root, { recursive: true, force: true });
  const scratch = join(root, ".covers");
  /** @type {{ albums: AlbumSpec[] }} */
  const { albums } = JSON.parse(spec);
  await Promise.all(
    albums.map((album) =>
      writeAlbum(join(root, album.artist, `${album.year} - ${album.title}`), album, scratch),
    ),
  );
  // Not part of the library: the scan would only skip it, but keep the tree clean.
  await rm(scratch, { recursive: true, force: true });
  await writeFile(stamp, `${fingerprint}\n${await snapshot(root)}`);
}
