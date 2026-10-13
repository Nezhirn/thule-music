import { CheckCircle2, CircleAlert, Copy, FileAudio, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useStore } from "zustand";
import { errorMessage } from "../api/errors";
import type { Album } from "../catalog/queries";
import { useI18n } from "../i18n";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import { ACCEPT, type AlbumUploadItem } from "./albumUploads";
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
      {album && <Uploader key={album.id} album={album} onClose={onClose} />}
    </Dialog>
  );
}

function Uploader({ album, onClose }: { album: Album; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.upload;
  const { uploads } = useEdits()!;
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const items = useStore(uploads.store, (state) => state.items).filter(
    (item) => item.albumId === album.id,
  );
  // What finished before this opening is old news.
  useEffect(() => uploads.clear(album.id), [uploads, album.id]);

  const add = (files: FileList | null) => {
    if (files?.length) uploads.add(album.id, [...files]);
  };
  const files = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <>
      <div
        className={styles.dropArea}
        data-over={over || undefined}
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
        <Button size="small" onClick={() => input.current?.click()}>
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
      <p className={styles.hint}>{text.hint}</p>
      {items.length > 0 && (
        <ul className={styles.uploads} aria-label={text.title}>
          {items.map((item) => (
            <UploadRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      <DialogButtons>
        <Button variant="secondary" onClick={onClose}>
          {t.edits.done}
        </Button>
      </DialogButtons>
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
  return (
    <li className={styles.upload}>
      {icon}
      <span className={styles.name}>
        {state.stage === "added" ? state.track.title : item.file.name}
        <span className={styles.by}>{status}</span>
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
