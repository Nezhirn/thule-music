import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import type { Schemas } from "../api/client";
import { errorMessage } from "../api/errors";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import { TextField } from "../ui/TextField";
import { useRenameArtist } from "./queries";
import styles from "./edits.module.css";

type ArtistRef = Schemas["ArtistRef"];

/** Renames an artist in the tags of all their tracks; another artist's name merges them. */
export function ArtistDialog({ artist, onClose }: { artist: ArtistRef | null; onClose(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={artist !== null}
      onClose={onClose}
      title={t.edits.artist.title}
      description={artist?.name}
    >
      {artist && <ArtistForm key={artist.id} artist={artist} onClose={onClose} />}
    </Dialog>
  );
}

function ArtistForm({ artist, onClose }: { artist: ArtistRef; onClose(): void }) {
  const { t } = useI18n();
  const text = t.edits.artist;
  const navigate = useNavigate();
  const rename = useRenameArtist(artist);
  const [name, setName] = useState(artist.name);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    rename.mutate(name, {
      onSuccess: (saved) => {
        onClose();
        // Merged into another artist: theirs is the page now.
        if (saved.id !== artist.id) void navigate(`/artists/${saved.id}`, { replace: true });
      },
    });
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <TextField
        label={text.name}
        value={name}
        maxLength={512}
        required
        onChange={(event) => setName(event.target.value)}
      />
      <p className={styles.hint}>{text.note}</p>
      {rename.error && <Alert tone="error">{errorMessage(t, rename.error)}</Alert>}
      <DialogButtons>
        <Button variant="secondary" onClick={onClose}>
          {t.edits.cancel}
        </Button>
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
