import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { Schemas } from "../api/client";
import { errorMessage } from "../api/errors";
import { artistNames } from "../catalog/format";
import { albumQuery, type Album, type Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons, DialogCancel } from "../ui/Dialog";
import type { GenreSubject } from "./context";
import { ArtistPicker } from "./Pickers";
import {
  useDeleteAlbum,
  useDeleteArtist,
  useDeleteGenre,
  useDeleteTrack,
  useRenameArtist,
} from "./queries";
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
      <Options legend={text.title} options={options} value={mode} onChange={setMode} />
      <DialogButtons>
        <DialogCancel onClick={onClose}>{t.edits.cancel}</DialogCancel>
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
        <DialogCancel onClick={onClose}>{t.edits.cancel}</DialogCancel>
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

/** The choices of a deletion, as radio buttons with a note under each. */
function Options<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: readonly { value: NoInfer<T>; label: string; note: string }[];
  value: T | null;
  onChange(value: NoInfer<T>): void;
}) {
  const name = useId();
  return (
    <fieldset className={styles.choices}>
      <legend className="visually-hidden">{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className={`${styles.choice} ${styles.option}`}>
          <input
            type="radio"
            name={name}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span className={styles.name}>
            {option.label}
            <span className={styles.by}>{option.note}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** Deletes an artist: with the files of their tracks, or giving everything of theirs to
 * another artist. */
export function DeleteArtistDialog({
  artist,
  onClose,
}: {
  artist: Schemas["ArtistDetail"] | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={artist !== null}
      onClose={onClose}
      title={t.edits.deleteArtistDialog.title}
      description={artist?.name}
      wide
    >
      {artist && <DeleteArtist key={artist.id} artist={artist} onClose={onClose} />}
    </Dialog>
  );
}

function DeleteArtist({ artist, onClose }: { artist: Schemas["ArtistDetail"]; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.deleteArtistDialog;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const remove = useDeleteArtist(artist);
  const give = useRenameArtist(artist);
  const [mode, setMode] = useState<"delete" | "give" | null>(null);
  const [heir, setHeir] = useState<string | null>(null);
  const busy = mode === "give" ? give : remove;
  const ready = mode === "delete" || (mode === "give" && heir !== null);
  const page = `/artists/${artist.id}`;

  function run() {
    if (mode === "delete") {
      remove.mutate(undefined, {
        onSuccess: () => {
          onClose();
          if (pathname === page) void navigate("/artists", { replace: true });
        },
      });
    } else if (mode === "give" && heir) {
      give.mutate(heir, {
        onSuccess: (saved) => {
          onClose();
          if (pathname === page) void navigate(`/artists/${saved.id}`, { replace: true });
        },
      });
    }
  }

  return (
    <>
      <Options
        legend={text.title}
        value={mode}
        onChange={(value) => {
          setMode(value);
          // The picker starts afresh when it shows again.
          setHeir(null);
        }}
        options={[
          { value: "delete", label: text.withFiles, note: text.withFilesNote },
          { value: "give", label: text.give, note: text.giveNote },
        ]}
      />
      {mode === "give" && (
        <ArtistPicker legend={text.giveTo} exclude={artist.id} onChange={setHeir} />
      )}
      {busy.error && <Alert tone="error">{errorMessage(t, busy.error)}</Alert>}
      <DialogButtons>
        <DialogCancel onClick={onClose}>{t.edits.cancel}</DialogCancel>
        <Button
          variant={mode === "give" ? "primary" : "danger"}
          disabled={!ready}
          busyLabel={busy.isPending && (mode === "give" ? text.giving : text.deleting)}
          onClick={run}
        >
          {mode === "give" ? text.giveSubmit : text.submit}
        </Button>
      </DialogButtons>
    </>
  );
}

/** Deletes a genre: taken off its albums, or with their files. */
export function DeleteGenreDialog({
  genre,
  onClose,
}: {
  genre: GenreSubject | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={genre !== null}
      onClose={onClose}
      title={t.edits.deleteGenreDialog.title}
      description={genre?.name}
    >
      {genre && <DeleteGenre key={genre.name} genre={genre} onClose={onClose} />}
    </Dialog>
  );
}

function DeleteGenre({ genre, onClose }: { genre: GenreSubject; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.deleteGenreDialog;
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const remove = useDeleteGenre(genre);
  const [mode, setMode] = useState<Schemas["GenreDeletion"] | null>(null);

  function run() {
    if (!mode) return;
    remove.mutate(mode, {
      onSuccess: () => {
        onClose();
        // The albums of a genre that is no more: all of them.
        const shown = new URLSearchParams(search);
        if (
          pathname === "/albums" &&
          shown.get("genre")?.toLowerCase() === genre.name.toLowerCase()
        ) {
          shown.delete("genre");
          void navigate(`/albums${shown.size ? `?${shown.toString()}` : ""}`, { replace: true });
        }
      },
    });
  }

  return (
    <>
      <Options
        legend={text.title}
        value={mode}
        onChange={setMode}
        options={[
          { value: "keep", label: text.keep, note: text.keepNote },
          { value: "delete", label: text.withAlbums, note: text.withAlbumsNote(genre.albumCount) },
        ]}
      />
      {remove.error && <Alert tone="error">{errorMessage(t, remove.error)}</Alert>}
      <DialogButtons>
        <DialogCancel onClick={onClose}>{t.edits.cancel}</DialogCancel>
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
