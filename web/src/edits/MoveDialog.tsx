import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { api } from "../api/client";
import { errorMessage, unwrap } from "../api/errors";
import { Cover } from "../catalog/Cover";
import { artistNames } from "../catalog/format";
import { albumQuery, artistQuery, type Album, type Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import type { MoveSubject } from "./context";
import { useMoveTracks } from "./queries";
import styles from "./edits.module.css";

const NEW = "new";

/** Moves tracks into another album, or a new one: their files go to its folder and get its
 * tags. */
export function MoveDialog({ subject, onClose }: { subject: MoveSubject | null; onClose(): void }) {
  const { t } = useI18n();
  const only = subject?.tracks.length === 1 ? subject.tracks[0] : undefined;
  return (
    <Dialog
      open={subject !== null}
      onClose={onClose}
      title={t.edits.move.title}
      description={only ? `${only.title} — ${artistNames(only)}` : subject?.tracks[0]?.album.title}
      wide
    >
      {subject && <MoveForm subject={subject} onClose={onClose} />}
    </Dialog>
  );
}

function MoveForm({ subject, onClose }: { subject: MoveSubject; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.move;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const move = useMoveTracks();
  const { tracks } = subject;
  // A single track has no choice to make: it is the one.
  const [selected, setSelected] = useState(
    () => new Set(tracks.length === 1 ? tracks.map((track) => track.id) : subject.selected),
  );
  const [target, setTarget] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newArtist, setNewArtist] = useState(tracks[0]?.album_artist.name ?? "");
  // The album they are all in, if one: not a place to move them to.
  const from = tracks.every((track) => track.album.id === tracks[0]?.album.id)
    ? tracks[0]?.album.id
    : undefined;
  const ready =
    selected.size > 0 &&
    target !== null &&
    (target !== NEW || (Boolean(newTitle.trim()) && Boolean(newArtist.trim())));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const track_ids = tracks.filter((track) => selected.has(track.id)).map((track) => track.id);
    const into =
      target === NEW
        ? { new_album: { title: newTitle, artist: newArtist } }
        : { album_id: target! };
    move.mutate(
      { track_ids, ...into },
      {
        onSuccess: (album) => {
          onClose();
          // All of the album on show moved: it is gone, the one they went to is shown.
          const shown = from ? queryClient.getQueryData(albumQuery(from).queryKey) : undefined;
          const emptied = shown?.tracks.every((track) => track_ids.includes(track.id));
          if (pathname === `/albums/${from}` && emptied) {
            void navigate(`/albums/${album.id}`, { replace: true });
          }
        },
      },
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      {tracks.length > 1 && <Which tracks={tracks} selected={selected} onChange={setSelected} />}
      <Albums track={tracks[0]!} exclude={from} target={target} onTarget={setTarget} />
      {target === NEW && (
        <div className={styles.pair}>
          <TextField
            label={text.newTitle}
            value={newTitle}
            maxLength={512}
            required
            autoFocus
            onChange={(event) => setNewTitle(event.target.value)}
          />
          <TextField
            label={text.newArtist}
            value={newArtist}
            maxLength={512}
            required
            onChange={(event) => setNewArtist(event.target.value)}
          />
        </div>
      )}
      <p className={styles.hint}>{text.note}</p>
      {move.error && <Alert tone="error">{errorMessage(t, move.error)}</Alert>}
      <DialogButtons>
        <Button variant="secondary" onClick={onClose}>
          {t.edits.cancel}
        </Button>
        <Button type="submit" disabled={!ready} busyLabel={move.isPending && text.moving}>
          {text.submit}
        </Button>
      </DialogButtons>
    </form>
  );
}

/** Checkboxes: all the tracks, and each. */
function Which({
  tracks,
  selected,
  onChange,
}: {
  tracks: Track[];
  selected: Set<string>;
  onChange(selected: Set<string>): void;
}) {
  const { t } = useI18n();
  const all = selected.size === tracks.length;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    onChange(next);
  };
  return (
    <fieldset className={styles.choices}>
      <legend className={styles.legend}>{t.edits.move.which}</legend>
      <label className={`${styles.choice} ${styles.all}`}>
        <input
          type="checkbox"
          checked={all}
          ref={(input) => {
            if (input) input.indeterminate = selected.size > 0 && !all;
          }}
          onChange={() => onChange(new Set(all ? [] : tracks.map((track) => track.id)))}
        />
        {t.edits.move.all}
      </label>
      <div className={styles.scroll}>
        {tracks.map((track) => (
          <label key={track.id} className={styles.choice}>
            <input
              type="checkbox"
              checked={selected.has(track.id)}
              onChange={() => toggle(track.id)}
            />
            <span className={styles.number}>{track.track_no ?? ""}</span>
            <span className={styles.name}>{track.title}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The albums to move to: found by title, or the artist's own to begin with; and a new
 * one. */
function Albums({
  track,
  exclude,
  target,
  onTarget,
}: {
  track: Track;
  exclude: string | undefined;
  target: string | null;
  onTarget(target: string): void;
}) {
  const { t } = useI18n();
  const text = t.edits.move;
  const name = useId();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const own = useQuery({ ...artistQuery(track.album_artist.id), enabled: !q });
  const found = useQuery({
    queryKey: ["albums", "titled", q],
    queryFn: () =>
      unwrap(api.GET("/api/v1/albums", { params: { query: { q, sort: "title", limit: 20 } } })),
    enabled: Boolean(q),
    placeholderData: keepPreviousData,
  });
  const albums: Album[] = (q ? found.data?.items : own.data?.albums) ?? [];
  const shown = albums.filter((album) => album.id !== exclude);

  return (
    <fieldset className={styles.choices}>
      <legend className={styles.legend}>{text.into}</legend>
      <TextField
        label={text.search}
        type="search"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      {!q && shown.length > 0 && <p className={styles.hint}>{text.sameArtist}</p>}
      <div className={styles.scroll} role="radiogroup" aria-label={text.into}>
        {shown.map((album) => (
          <label key={album.id} className={styles.choice}>
            <input
              type="radio"
              name={name}
              checked={target === album.id}
              onChange={() => onTarget(album.id)}
            />
            <Cover id={album.cover_id} sizes="40px" className={styles.thumb} />
            <span className={styles.name}>
              {album.title}
              <span className={styles.by}>
                {album.artist.name}
                {album.year && ` · ${album.year}`}
              </span>
            </span>
          </label>
        ))}
        {shown.length === 0 && (
          <p className={styles.hint}>{q ? text.noAlbums : text.noOtherAlbums}</p>
        )}
      </div>
      <label className={`${styles.choice} ${styles.all}`}>
        <input type="radio" name={name} checked={target === NEW} onChange={() => onTarget(NEW)} />
        {text.newAlbum}
      </label>
    </fieldset>
  );
}
