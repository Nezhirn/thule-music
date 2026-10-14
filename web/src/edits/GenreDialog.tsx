import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { errorMessage } from "../api/errors";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons, DialogCancel } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import type { GenreSubject } from "./context";
import { useRenameGenre } from "./queries";
import styles from "./edits.module.css";

/** Renames a genre in the tags of its albums' tracks; another genre's name merges them. */
export function GenreDialog({ genre, onClose }: { genre: GenreSubject | null; onClose(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={genre !== null}
      onClose={onClose}
      title={t.edits.genre.title}
      description={genre?.name}
    >
      {genre && <GenreForm key={genre.name} genre={genre} onClose={onClose} />}
    </Dialog>
  );
}

function GenreForm({ genre, onClose }: { genre: GenreSubject; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.genre;
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const rename = useRenameGenre(genre);
  const [name, setName] = useState(genre.name);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    rename.mutate(name, {
      onSuccess: (saved) => {
        onClose();
        // The albums list of the genre: under its new name.
        const shown = new URLSearchParams(search);
        if (
          pathname === "/albums" &&
          shown.get("genre")?.toLowerCase() === genre.name.toLowerCase()
        ) {
          shown.set("genre", saved.name);
          void navigate(`/albums?${shown.toString()}`, { replace: true });
        }
      },
    });
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <TextField
        label={text.name}
        value={name}
        maxLength={128}
        required
        onChange={(event) => setName(event.target.value)}
      />
      <p className={styles.hint}>{text.note(genre.albumCount)}</p>
      {rename.error && <Alert tone="error">{errorMessage(t, rename.error)}</Alert>}
      <DialogButtons>
        <DialogCancel onClick={onClose}>{t.edits.cancel}</DialogCancel>
        <Button
          type="submit"
          disabled={!name.trim()}
          busyLabel={rename.isPending && t.edits.saving}
        >
          {t.edits.save}
        </Button>
      </DialogButtons>
    </form>
  );
}
