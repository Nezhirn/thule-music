import { ImageUp } from "lucide-react";
import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import type { Schemas } from "../api/client";
import { errorMessage } from "../api/errors";
import { ArtistImage } from "../catalog/ArtistImage";
import { Cover } from "../catalog/Cover";
import { artistNames } from "../catalog/format";
import type { Album, Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import type { CoverSubject } from "./context";
import { MAX_COVER_BYTES, useAlbumCover, useArtistCover, useTrackCover } from "./queries";
import styles from "./edits.module.css";

/** Where an admin chooses an album's cover, a track's own picture or an artist's, or gives
 * it up. */
export function CoverDialog({
  subject,
  onClose,
}: {
  subject: CoverSubject | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  const text = t.edits.cover;
  let title = "";
  let description = "";
  if (subject?.kind === "album") {
    title = text.album;
    description = `${subject.album.title} — ${subject.album.artist.name}`;
  } else if (subject?.kind === "track") {
    title = text.track;
    description = `${subject.track.title} — ${artistNames(subject.track)}`;
  } else if (subject) {
    title = text.artist;
    description = subject.artist.name;
  }
  return (
    <Dialog open={subject !== null} onClose={onClose} title={title} description={description}>
      {subject?.kind === "album" && (
        <AlbumCover key={subject.album.id} album={subject.album} onClose={onClose} />
      )}
      {subject?.kind === "track" && (
        <TrackCover key={subject.track.id} track={subject.track} onClose={onClose} />
      )}
      {subject?.kind === "artist" && (
        <ArtistPicture key={subject.artist.id} artist={subject.artist} onClose={onClose} />
      )}
    </Dialog>
  );
}

function AlbumCover({
  album,
  onClose,
}: {
  album: Album & { cover_custom?: boolean };
  onClose(): void;
}) {
  const { t } = useI18n();
  const change = useAlbumCover(album);
  const [shown, setShown] = useState({ id: album.cover_id, custom: album.cover_custom ?? false });
  return (
    <CoverPicker
      art={<Cover id={shown.id} sizes="240px" className={styles.preview} />}
      note={t.edits.cover.albumNote}
      resetLabel={shown.custom ? t.edits.cover.resetAlbum : null}
      change={(picture) =>
        change.mutate(picture, {
          onSuccess: (out) => setShown({ id: out.cover_id, custom: picture !== null }),
        })
      }
      pending={change.isPending ? (change.variables ? "upload" : "reset") : null}
      error={change.error}
      onClose={onClose}
    />
  );
}

function TrackCover({ track, onClose }: { track: Track; onClose(): void }) {
  const { t } = useI18n();
  const change = useTrackCover(track);
  const [shown, setShown] = useState({
    id: track.cover_id,
    custom: track.cover_id !== null && track.cover_id !== track.album.cover_id,
  });
  return (
    <CoverPicker
      art={<Cover id={shown.id} sizes="240px" className={styles.preview} />}
      note={t.edits.cover.trackNote}
      resetLabel={shown.custom ? t.edits.cover.resetTrack : null}
      change={(picture) =>
        change.mutate(picture, {
          onSuccess: (out) => setShown({ id: out.cover_id, custom: picture !== null }),
        })
      }
      pending={change.isPending ? (change.variables ? "upload" : "reset") : null}
      error={change.error}
      onClose={onClose}
    />
  );
}

function ArtistPicture({ artist, onClose }: { artist: Schemas["ArtistDetail"]; onClose(): void }) {
  const { t } = useI18n();
  const change = useArtistCover(artist);
  const [shown, setShown] = useState({ id: artist.cover_id, custom: artist.cover_custom });
  return (
    <CoverPicker
      art={
        <ArtistImage
          name={artist.name}
          coverId={shown.id}
          sizes="240px"
          className={`${styles.preview} ${styles.portrait}`}
        />
      }
      note={t.edits.cover.artistNote}
      resetLabel={shown.custom ? t.edits.cover.resetArtist : null}
      change={(picture) =>
        change.mutate(picture, {
          onSuccess: (out) => setShown({ id: out.cover_id, custom: picture !== null }),
        })
      }
      pending={change.isPending ? (change.variables ? "upload" : "reset") : null}
      error={change.error}
      onClose={onClose}
    />
  );
}

/** The picture as it is, a drop zone over it, the buttons to choose an image or give it
 * up. */
function CoverPicker({
  art,
  note,
  resetLabel,
  change,
  pending,
  error,
  onClose,
}: {
  art: ReactNode;
  note: string;
  /** The button giving up the chosen cover; null when there is none to give up. */
  resetLabel: string | null;
  /** An image to upload, or null to give up the chosen one. */
  change(picture: File | null): void;
  pending: "upload" | "reset" | null;
  error: Error | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  const text = t.edits.cover;
  const input = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) setRefused(text.notImage);
    else if (file.size > MAX_COVER_BYTES) setRefused(text.tooLarge);
    else {
      setRefused(null);
      change(file);
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file again is a new choice
    pick(file);
  }

  const files = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <>
      <div
        className={styles.drop}
        data-over={over || undefined}
        onDragOver={(event) => {
          if (!files(event) || pending) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          if (!files(event) || pending) return;
          event.preventDefault();
          setOver(false);
          pick(event.dataTransfer.files[0]);
        }}
      >
        {art}
        <span className={styles.dropHint} aria-hidden="true">
          <ImageUp />
          {text.drop}
        </span>
      </div>
      <p className={styles.hint}>{note}</p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={text.choose}
        hidden
        onChange={onFile}
      />
      <div className={styles.choose}>
        <Button
          size="small"
          disabled={pending !== null}
          busyLabel={pending === "upload" && text.saving}
          onClick={() => input.current?.click()}
        >
          {text.choose}
        </Button>
        {resetLabel && (
          <Button
            variant="secondary"
            size="small"
            disabled={pending !== null}
            busyLabel={pending === "reset" && text.saving}
            onClick={() => change(null)}
          >
            {resetLabel}
          </Button>
        )}
        <span className={styles.hint}>{text.hint}</span>
      </div>
      {refused && <Alert tone="error">{refused}</Alert>}
      {error && !refused && <Alert tone="error">{errorMessage(t, error)}</Alert>}
      <DialogButtons>
        <Button variant="secondary" onClick={onClose}>
          {t.edits.done}
        </Button>
      </DialogButtons>
    </>
  );
}
