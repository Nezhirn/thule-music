import {
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  Folder,
  LoaderCircle,
  RotateCcw,
  UploadCloud,
  type LucideIcon,
} from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { Link } from "react-router";
import { errorMessage } from "../api/errors";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { IconButton } from "../ui/IconButton";
import { UnreadableFile } from "./send";
import { ACCEPT, inProgress, type Picked, type Upload, type UploadState } from "./uploads";
import { useUploads, useUploadsState } from "./uploadsContext";
import styles from "./admin.module.css";

/** Uploading music: files or whole album folders, followed until they are in the library. */
export function UploadsAdmin() {
  return (
    <div className={styles.cards}>
      <Picker />
      <UploadList />
    </div>
  );
}

function Picker() {
  const { t } = useI18n();
  const text = t.admin.uploads;
  const uploads = useUploads();
  const { skipped } = useUploadsState();
  const [over, setOver] = useState(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const dragging = (event: DragEvent) => {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setOver(true);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    void dropped(event.dataTransfer).then((picked) => uploads.add(picked));
  };
  const onPicked = (input: HTMLInputElement) => {
    uploads.add(
      [...(input.files ?? [])].map((file) => ({
        file,
        // Set by browsers when a folder is picked; not everywhere otherwise.
        folder: parentOf((file.webkitRelativePath as string | undefined) ?? ""),
      })),
    );
    input.value = "";
  };

  return (
    <Card title={text.title}>
      <div
        className={styles.drop}
        data-over={over || undefined}
        onDragEnter={dragging}
        onDragOver={dragging}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={onDrop}
      >
        <UploadCloud className={styles.dropIcon} aria-hidden />
        <p className={styles.dropText}>{text.drop}</p>
        <p className={styles.note}>{text.or}</p>
        <div className={styles.actions}>
          <Button onClick={() => filesInput.current?.click()}>{text.chooseFiles}</Button>
          <Button variant="secondary" onClick={() => folderInput.current?.click()}>
            {text.chooseFolder}
          </Button>
        </div>
        <input
          ref={filesInput}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(event) => onPicked(event.currentTarget)}
        />
        <input
          ref={folderInput}
          type="file"
          hidden
          {...{ webkitdirectory: "" }}
          onChange={(event) => onPicked(event.currentTarget)}
        />
      </div>
      <p className={styles.note}>{text.hint}</p>
      {skipped > 0 && <Alert tone="info">{text.skipped(skipped)}</Alert>}
    </Card>
  );
}

/** "Artist/Album/01.mp3" -> "Artist/Album". */
function parentOf(path: string): string {
  const slash = path.replace(/^\/+/, "").lastIndexOf("/");
  return slash > 0 ? path.replace(/^\/+/, "").slice(0, slash) : "";
}

/** The files dropped, with the folders they were in; folders are read through. */
async function dropped(data: DataTransfer): Promise<Picked[]> {
  // Only readable while the drop event is handled: taken before anything is awaited.
  const entries = [...data.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!entries.length) return [...data.files].map((file) => ({ file, folder: "" }));
  const picked: Picked[] = [];
  await Promise.all(entries.map((entry) => walk(entry, picked)));
  return picked;
}

async function walk(entry: FileSystemEntry, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ file, folder: parentOf(entry.fullPath) });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // A folder's entries come in batches, until an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) break;
      await Promise.all(batch.map((child) => walk(child, out)));
    }
  }
}

function UploadList() {
  const { t } = useI18n();
  const text = t.admin.uploads;
  const uploads = useUploads();
  const { items } = useUploadsState();
  if (!items.length) return null;

  const done = items.filter((item) => !inProgress(item)).length;
  const folders = new Map<string, Upload[]>();
  for (const item of items) folders.set(item.folder, [...(folders.get(item.folder) ?? []), item]);
  const byName = (a: Upload, b: Upload) =>
    a.file.name.localeCompare(b.file.name, undefined, { numeric: true });

  return (
    <Card title={text.list}>
      <div className={styles.groupHead}>
        <p className={styles.note}>{text.summary(done, items.length)}</p>
        {done > 0 && (
          <Button variant="secondary" size="small" onClick={() => uploads.clear()}>
            {text.clear}
          </Button>
        )}
      </div>
      <ul className={styles.folders}>
        {[...folders].map(([folder, files]) => (
          <li key={folder}>
            {folder && (
              <p className={styles.folder}>
                <Folder className={styles.folderIcon} aria-hidden />
                {folder}
              </p>
            )}
            <ul aria-label={folder || text.list}>
              {files.sort(byName).map((upload) => (
                <UploadRow key={upload.id} upload={upload} />
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const ICONS: Record<UploadState["stage"], LucideIcon> = {
  waiting: Clock,
  uploading: LoaderCircle,
  importing: LoaderCircle,
  added: CircleCheck,
  saved: CircleCheck,
  duplicate: Copy,
  failed: CircleAlert,
  error: CircleAlert,
};

function UploadRow({ upload }: { upload: Upload }) {
  const { t } = useI18n();
  const text = t.admin.uploads.states;
  const uploads = useUploads();
  const { state, file } = upload;
  const Icon = ICONS[state.stage];
  const track =
    state.stage === "added" || state.stage === "duplicate" ? (state.track ?? null) : null;

  return (
    <li className={styles.upload} data-stage={state.stage}>
      <Icon className={styles.uploadIcon} aria-hidden />
      <div className={styles.uploadText}>
        <p className={styles.uploadName}>{file.name}</p>
        <p className={styles.uploadState}>
          {state.stage === "uploading"
            ? text.uploading(Math.round(state.progress * 100))
            : text[state.stage]}
          {track && (
            <>
              {" · "}
              <Link to={`/albums/${track.album.id}`}>{track.album.title}</Link>
              {` — ${track.album_artist.name}`}
            </>
          )}
        </p>
        {state.stage === "uploading" && (
          <progress
            className={styles.progress}
            aria-label={file.name}
            value={state.progress}
            max={1}
          />
        )}
        {state.stage === "failed" && state.error && (
          <p className={styles.jobError}>{state.error}</p>
        )}
        {state.stage === "error" && (
          <p className={styles.jobError}>
            {state.error instanceof UnreadableFile
              ? t.admin.uploads.unreadable
              : errorMessage(t, state.error)}
          </p>
        )}
      </div>
      {state.stage === "error" && (
        <IconButton
          icon={RotateCcw}
          label={t.admin.uploads.retry(file.name)}
          onClick={() => uploads.retry(upload.id)}
        />
      )}
    </li>
  );
}
