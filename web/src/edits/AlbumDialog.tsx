import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { errorMessage } from "../api/errors";
import type { Album } from "../catalog/queries";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import { useUpdateAlbum } from "./queries";
import styles from "./edits.module.css";

/** An album's title, artist, year and genre, written into its tracks' tags. */
export function AlbumDialog({ album, onClose }: { album: Album | null; onClose(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={album !== null}
      onClose={onClose}
      title={t.edits.album.title}
      description={album && `${album.title} — ${album.artist.name}`}
    >
      {album && <AlbumForm key={album.id} album={album} onClose={onClose} />}
    </Dialog>
  );
}

function AlbumForm({ album, onClose }: { album: Album; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.album;
  const navigate = useNavigate();
  const save = useUpdateAlbum(album);
  const [title, setTitle] = useState(album.title);
  const [artist, setArtist] = useState(album.artist.name);
  const [year, setYear] = useState(album.year?.toString() ?? "");
  const [genre, setGenre] = useState(album.genre ?? "");
  const yearValue = year.trim() ? Number(year) : null;
  const badYear =
    yearValue !== null && !(Number.isInteger(yearValue) && yearValue >= 1000 && yearValue <= 9999);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !artist.trim() || badYear) return;
    save.mutate(
      { title, artist, year: yearValue, genre: genre.trim() || null },
      {
        onSuccess: (saved) => {
          onClose();
          // Merged into another album: its page.
          if (saved.id !== album.id) void navigate(`/albums/${saved.id}`, { replace: true });
        },
      },
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
      <TextField
        label={text.artist}
        value={artist}
        maxLength={512}
        required
        onChange={(event) => setArtist(event.target.value)}
      />
      <div className={styles.pair}>
        <TextField
          label={text.year}
          note={t.common.optional}
          inputMode="numeric"
          value={year}
          onChange={(event) => setYear(event.target.value)}
          error={badYear ? t.edits.badYear : null}
        />
        <TextField
          label={text.genre}
          note={t.common.optional}
          value={genre}
          maxLength={128}
          onChange={(event) => setGenre(event.target.value)}
        />
      </div>
      <p className={styles.hint}>{t.edits.tagsNote}</p>
      {save.error && <Alert tone="error">{errorMessage(t, save.error)}</Alert>}
      <DialogButtons>
        <Button variant="secondary" onClick={onClose}>
          {t.edits.cancel}
        </Button>
        <Button
          type="submit"
          disabled={!title.trim() || !artist.trim() || badYear}
          busyLabel={save.isPending && t.edits.saving}
        >
          {t.edits.save}
        </Button>
      </DialogButtons>
    </form>
  );
}
