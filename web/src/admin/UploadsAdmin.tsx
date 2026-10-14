import {
  CircleAlert,
  CircleCheck,
  Clock,
  Copy,
  Folder,
  LoaderCircle,
  RotateCcw,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react";
import { memo, useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { errorMessage } from "../api/errors";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { IconButton } from "../ui/IconButton";
import { UnreadableFile } from "./send";
import { ACCEPT, inProgress, type Picked, type Upload, type UploadState } from "./uploads";
import { useUploads } from "./uploadsContext";
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
  const skipped = useStore(uploads.store, (state) => state.skipped);
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
  // The list's shape (which files, in which folders) changes only when files are added or
  // cleared; each row follows its own file. Progress renders one row, not thousands.
  const ids = useStore(
    uploads.store,
    useShallow((state) => state.items.map((item) => item.id)),
  );
  const folders = useMemo(() => {
    const byName = (a: Upload, b: Upload) =>
      a.file.name.localeCompare(b.file.name, undefined, { numeric: true });
    // The files `ids` lists, read when they change.
    const byId = new Map(uploads.store.getState().items.map((item) => [item.id, item]));
    const items = ids.flatMap((id) => byId.get(id) ?? []);
    const grouped = new Map<string, Upload[]>();
    for (const item of items) grouped.set(item.folder, [...(grouped.get(item.folder) ?? []), item]);
    return [...grouped].map(([folder, files]) => ({
      folder,
      ids: files.sort(byName).map((item) => item.id),
    }));
  }, [uploads, ids]);
  const done = useStore(uploads.store, (state) => state.items.filter((i) => !inProgress(i)).length);
  const sending = useStore(uploads.store, (state) =>
    state.items.some((i) => i.state.stage === "waiting" || i.state.stage === "uploading"),
  );
  const stuck = useStore(uploads.store, (state) => state.importsStuck);
  if (!ids.length) return null;

  return (
    <Card title={text.list}>
      <div className={styles.groupHead}>
        <p className={styles.note}>{text.summary(done, ids.length)}</p>
        <div className={styles.actions}>
          {sending && (
            <Button variant="secondary" size="small" onClick={() => uploads.cancel()}>
              {text.cancelRest}
            </Button>
          )}
          {done > 0 && (
            <Button variant="secondary" size="small" onClick={() => uploads.clear()}>
              {text.clear}
            </Button>
          )}
        </div>
      </div>
      {stuck && <Alert tone="info">{text.stuck}</Alert>}
      <ul className={styles.folders}>
        {folders.map(({ folder, ids }) => (
          <li key={folder}>
            {folder && (
              <p className={styles.folder}>
                <Folder className={styles.folderIcon} aria-hidden />
                {folder}
              </p>
            )}
            <ul aria-label={folder || text.list}>
              {ids.map((id) => (
                <UploadRow key={id} id={id} />
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

const UploadRow = memo(function UploadRow({ id }: { id: number }) {
  const { t } = useI18n();
  const text = t.admin.uploads.states;
  const uploads = useUploads();
  const upload = useStore(uploads.store, (state) => state.items.find((item) => item.id === id));
  if (!upload) return null;
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
      {(state.stage === "waiting" || state.stage === "uploading") && (
        <IconButton
          icon={X}
          label={t.admin.uploads.cancel(file.name)}
          onClick={() => uploads.cancel([upload.id])}
        />
      )}
    </li>
  );
});
