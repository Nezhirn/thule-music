import { CheckCircle2, CircleAlert, Copy, FileAudio, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useStore } from "zustand";
import type { Schemas } from "../api/client";
import { errorMessage } from "../api/errors";
import type { Album } from "../catalog/queries";
import { useI18n } from "../i18n";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import { ACCEPT, placeOf, type AlbumUploadItem, type UploadTarget } from "./albumUploads";
import { useEdits } from "./context";
import styles from "./edits.module.css";

/** Uploads audio files into an album: picked or dropped, sent one by one; the uploads go on
 * when the dialog is closed. */
export function UploadDialog({ album, onClose }: { album: Album | null; onClose(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={album !== null}
      onClose={onClose}
      title={t.edits.upload.title}
      description={album && `${album.title} — ${album.artist.name}`}
    >
      {album && (
        <>
          <Uploads
            key={album.id}
            target={{ kind: "album", albumId: album.id }}
            hint={t.edits.upload.hint}
          />
          <DialogButtons>
            <Button variant="secondary" onClick={onClose}>
              {t.edits.done}
            </Button>
          </DialogButtons>
        </>
      )}
    </Dialog>
  );
}

/** Uploads an album of the artist: its title (and year and genre) first, then the files. */
export function ArtistUploadDialog({
  artist,
  onClose,
}: {
  artist: Schemas["ArtistRef"] | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={artist !== null}
      onClose={onClose}
      title={t.edits.artistUpload.title}
      description={artist?.name}
    >
      {artist && <ArtistUpload key={artist.id} artist={artist} onClose={onClose} />}
    </Dialog>
  );
}

function ArtistUpload({ artist, onClose }: { artist: Schemas["ArtistRef"]; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.artistUpload;
  const [title, setTitle] = useState("");
  const [year, setYear] = useState("");
  const [genre, setGenre] = useState("");
  const yearValue = year.trim() ? Number(year) : null;
  const badYear =
    yearValue !== null && !(Number.isInteger(yearValue) && yearValue >= 1000 && yearValue <= 9999);
  const ready = Boolean(title.trim()) && !badYear;
  return (
    <>
      <div className={styles.form}>
        <TextField
          label={text.album}
          value={title}
          maxLength={512}
          required
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
        <div className={styles.pair}>
          <TextField
            label={t.edits.album.year}
            note={t.common.optional}
            inputMode="numeric"
            value={year}
            onChange={(event) => setYear(event.target.value)}
            error={badYear ? t.edits.badYear : null}
          />
          <TextField
            label={t.edits.album.genre}
            note={t.common.optional}
            value={genre}
            maxLength={128}
            onChange={(event) => setGenre(event.target.value)}
          />
        </div>
        <p className={styles.hint}>{text.note}</p>
      </div>
      <Uploads
        target={
          ready
            ? {
                kind: "artist",
                artistId: artist.id,
                album: title.trim(),
                year: yearValue,
                genre: genre.trim() || null,
              }
            : null
        }
        place={`artist:${artist.id}`}
        hint={ready ? text.hint : text.needTitle}
      />
      <DialogButtons>
        <Button variant="secondary" onClick={onClose}>
          {t.edits.done}
        </Button>
      </DialogButtons>
    </>
  );
}

/** Where files are dropped or picked, and how their uploads go. Without a target (not
 * ready yet), nothing can be added; `place` then says whose uploads to show. */
function Uploads({
  target,
  place = target ? placeOf(target) : "",
  hint,
}: {
  target: UploadTarget | null;
  place?: string;
  hint: string;
}) {
  const { t } = useI18n();
  const text = t.edits.upload;
  const { uploads } = useEdits()!;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const items = useStore(uploads.store, (state) => state.items).filter(
    (item) => item.place === place,
  );
  // What finished before this opening is old news.
  useEffect(() => uploads.clear(place), [uploads, place]);

  const add = (files: FileList | null) => {
    if (target && files?.length) uploads.add(target, [...files]);
  };
  const files = (event: DragEvent) => target !== null && event.dataTransfer.types.includes("Files");

  return (
    <>
      <div
        className={styles.dropArea}
        data-over={over || undefined}
        data-disabled={!target || undefined}
        onDragOver={(event) => {
          if (!files(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          if (!files(event)) return;
          event.preventDefault();
          setOver(false);
          add(event.dataTransfer.files);
        }}
      >
        <Upload aria-hidden="true" className={styles.dropIcon} />
        <span>{text.drop}</span>
        <Button size="small" disabled={!target} onClick={() => input.current?.click()}>
          {text.choose}
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        aria-label={text.choose}
        hidden
        onChange={(event) => {
          add(event.target.files);
          event.target.value = ""; // the same files again are a new choice
        }}
      />
      <p className={styles.hint}>{hint}</p>
      {items.length > 0 && (
        <ul className={styles.uploads} aria-label={text.title}>
          {items.map((item) => (
            <UploadRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </>
  );
}

function UploadRow({ item }: { item: AlbumUploadItem }) {
  const { t } = useI18n();
  const text = t.edits.upload;
  const { state } = item;
  let icon = <FileAudio aria-hidden="true" className={styles.uploadIcon} />;
  let status: string;
  if (state.stage === "waiting") status = text.waiting;
  else if (state.stage === "sending") status = `${Math.round(state.progress * 100)}%`;
  else if (state.stage === "added") {
    icon = <CheckCircle2 aria-hidden="true" className={`${styles.uploadIcon} ${styles.ok}`} />;
    status = text.added;
  } else if (state.stage === "duplicate") {
    icon = <Copy aria-hidden="true" className={styles.uploadIcon} />;
    status = text.duplicate;
  } else {
    icon = <CircleAlert aria-hidden="true" className={`${styles.uploadIcon} ${styles.bad}`} />;
    status = errorMessage(t, state.error);
  }
  // Uploaded for an artist: which of their albums it went to.
  const into = item.target.kind === "artist" ? ` · ${item.target.album}` : "";
  return (
    <li className={styles.upload}>
      {icon}
      <span className={styles.name}>
        {state.stage === "added" ? state.track.title : item.file.name}
        <span className={styles.by}>
          {status}
          {into}
        </span>
      </span>
      {state.stage === "sending" && (
        <progress
          className={styles.progress}
          value={state.progress}
          max={1}
          aria-label={item.file.name}
        />
      )}
    </li>
  );
}
