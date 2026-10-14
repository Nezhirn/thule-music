import { Plus, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../api/errors";
import { artistNames } from "../catalog/format";
import type { Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons, DialogCancel } from "../ui/Dialog";
import { IconButton } from "../ui/IconButton";
import { TextField } from "../ui/TextField";
import { useUpdateTrack } from "./queries";
import styles from "./edits.module.css";

/** A track's title, artists, number and disc, written into its file's tags. */
export function TrackDialog({ track, onClose }: { track: Track | null; onClose(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={track !== null}
      onClose={onClose}
      title={t.edits.track.title}
      description={track && `${track.title} — ${artistNames(track)}`}
    >
      {track && <TrackForm key={track.id} track={track} onClose={onClose} />}
    </Dialog>
  );
}

/** A whole number in a range, or null for an empty field; undefined when it isn't one. */
function number(value: string, max: number): number | null | undefined {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : undefined;
}

function TrackForm({ track, onClose }: { track: Track; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.track;
  const save = useUpdateTrack(track);
  const [title, setTitle] = useState(track.title);
  const credited = track.artists.length ? track.artists : [track.artist];
  // Each with a key of its own, so removing one keeps the others' fields.
  const [artists, setArtists] = useState(() =>
    credited.map((artist, i) => ({ key: i, name: artist.name })),
  );
  const [nextKey, setNextKey] = useState(credited.length);
  const [trackNo, setTrackNo] = useState(track.track_no?.toString() ?? "");
  const [discNo, setDiscNo] = useState(track.disc_no?.toString() ?? "");
  const trackValue = number(trackNo, 999);
  const discValue = number(discNo, 99);
  const names = artists.map((artist) => artist.name.trim()).filter(Boolean);
  const valid =
    Boolean(title.trim()) &&
    names.length > 0 &&
    trackValue !== undefined &&
    discValue !== undefined;

  const rename = (key: number, name: string) =>
    setArtists(artists.map((artist) => (artist.key === key ? { ...artist, name } : artist)));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    save.mutate(
      { title, artists: names, track_no: trackValue, disc_no: discValue },
      { onSuccess: onClose },
    );
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <TextField
        label={text.name}
        value={title}
        maxLength={512}
        required
        onChange={(event) => setTitle(event.target.value)}
      />
      <fieldset className={styles.artists}>
        <legend className={styles.legend}>{text.artists}</legend>
        {artists.map((artist, i) => (
          <div key={artist.key} className={styles.artist}>
            <TextField
              label={i === 0 ? text.main : text.featured(i)}
              value={artist.name}
              maxLength={512}
              onChange={(event) => rename(artist.key, event.target.value)}
            />
            {artists.length > 1 && (
              <IconButton
                icon={X}
                size="sm"
                label={text.removeArtist(artist.name.trim())}
                onClick={() => setArtists(artists.filter((one) => one.key !== artist.key))}
              />
            )}
          </div>
        ))}
        {artists.length < 20 && (
          <Button
            variant="secondary"
            size="small"
            className={styles.add}
            onClick={() => {
              setArtists([...artists, { key: nextKey, name: "" }]);
              setNextKey(nextKey + 1);
            }}
          >
            <Plus aria-hidden="true" className={styles.addIcon} />
            {text.addArtist}
          </Button>
        )}
      </fieldset>
      <div className={styles.pair}>
        <TextField
          label={text.number}
          note={t.common.optional}
          inputMode="numeric"
          value={trackNo}
          onChange={(event) => setTrackNo(event.target.value)}
          error={trackValue === undefined ? t.edits.badNumber(999) : null}
        />
        <TextField
          label={text.disc}
          note={t.common.optional}
          inputMode="numeric"
          value={discNo}
          onChange={(event) => setDiscNo(event.target.value)}
          error={discValue === undefined ? t.edits.badNumber(99) : null}
        />
      </div>
      <p className={styles.hint}>{t.edits.tagsNote}</p>
      {save.error && <Alert tone="error">{errorMessage(t, save.error)}</Alert>}
      <DialogButtons>
        <DialogCancel onClick={onClose}>{t.edits.cancel}</DialogCancel>
        <Button type="submit" disabled={!valid} busyLabel={save.isPending && t.edits.saving}>
          {t.edits.save}
        </Button>
      </DialogButtons>
    </form>
  );
}
