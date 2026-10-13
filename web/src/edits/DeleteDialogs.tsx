import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Schemas } from "../api/client";
import { artistNames } from "../catalog/format";
import { albumQuery, type Album, type Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import { useDeleteAlbum, useDeleteTrack } from "./queries";
import styles from "./edits.module.css";

/** Deletes an album: with its tracks' files, or keeping the tracks as singles. */
export function DeleteAlbumDialog({
  subject,
  onClose,
}: {
  subject: { album: Album; tracks: Track[] } | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  const album = subject?.album;
  return (
    <Dialog
      open={subject !== null}
      onClose={onClose}
      title={t.edits.deleteAlbumDialog.title}
      description={album && `${album.title} — ${album.artist.name}`}
    >
      {subject && (
        <DeleteAlbum
          key={subject.album.id}
          album={subject.album}
          count={subject.tracks.length}
          onClose={onClose}
        />
      )}
    </Dialog>
  );
}

function DeleteAlbum({ album, count, onClose }: { album: Album; count: number; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.deleteAlbumDialog;
  const name = useId();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const remove = useDeleteAlbum(album);
  const [mode, setMode] = useState<Schemas["AlbumDeletion"] | null>(null);
  const options = [
    { value: "delete", label: text.withTracks, note: text.withTracksNote(count) },
    { value: "singles", label: text.singles, note: text.singlesNote },
  ] as const;

  function run() {
    if (!mode) return;
    remove.mutate(mode, {
      onSettled: onClose,
      onSuccess: () => {
        if (pathname !== `/albums/${album.id}`) return;
        // The page of an album that is no more: its artist's (who has the singles), or the
        // albums when its files went.
        void navigate(mode === "singles" ? `/artists/${album.artist.id}` : "/albums", {
          replace: true,
        });
      },
    });
  }

  return (
    <>
      <fieldset className={styles.choices}>
        <legend className="visually-hidden">{text.title}</legend>
        {options.map((option) => (
          <label key={option.value} className={`${styles.choice} ${styles.option}`}>
            <input
              type="radio"
              name={name}
              checked={mode === option.value}
              onChange={() => setMode(option.value)}
            />
            <span className={styles.name}>
              {option.label}
              <span className={styles.by}>{option.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <DialogButtons>
        <Button variant="secondary" onClick={onClose}>
          {t.edits.cancel}
        </Button>
        <Button
          variant="danger"
          disabled={!mode}
          busyLabel={remove.isPending && text.deleting}
          onClick={run}
        >
          {text.submit}
        </Button>
      </DialogButtons>
    </>
  );
}

/** Deletes a track's file from the disk. */
export function DeleteTrackDialog({ track, onClose }: { track: Track | null; onClose(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={track !== null}
      onClose={onClose}
      title={t.edits.deleteTrackDialog.title}
      description={track && `${track.title} — ${artistNames(track)}`}
    >
      {track && <DeleteTrack key={track.id} track={track} onClose={onClose} />}
    </Dialog>
  );
}

function DeleteTrack({ track, onClose }: { track: Track; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.deleteTrackDialog;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const remove = useDeleteTrack(track);
  return (
    <>
      <p className={styles.hint}>{text.text}</p>
      <DialogButtons>
        <Button variant="secondary" onClick={onClose}>
          {t.edits.cancel}
        </Button>
        <Button
          variant="danger"
          busyLabel={remove.isPending && text.deleting}
          onClick={() =>
            remove.mutate(undefined, {
              onSettled: onClose,
              onSuccess: () => {
                // The last track of the album on show: the album is gone too.
                const page = `/albums/${track.album.id}`;
                const album = queryClient.getQueryData(albumQuery(track.album.id).queryKey);
                if (pathname === page && (album?.tracks.length ?? 0) <= 1) {
                  void navigate("/albums", { replace: true });
                }
              },
            })
          }
        >
          {text.submit}
        </Button>
      </DialogButtons>
    </>
  );
}
