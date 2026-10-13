import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { api } from "../api/client";
import { errorMessage, unwrap } from "../api/errors";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import { TextArea, TextField } from "../ui/TextField";
import { changePlaylist, playlistQuery, playlistsQuery, type PlaylistDetail } from "./queries";
import styles from "./playlists.module.css";

interface Props {
  open: boolean;
  onClose(): void;
  /** The playlist to edit; a new one is created without. */
  playlist?: PlaylistDetail;
  /** Created or saved. */
  onDone?(playlist: PlaylistDetail): void;
}

/** A playlist's name and description: for a new playlist, or to change them. */
export function PlaylistDialog({ open, onClose, playlist, onDone }: Props) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={playlist ? t.playlists.edit : t.playlists.new}>
      <PlaylistForm playlist={playlist} onCancel={onClose} onDone={onDone ?? (() => {})} />
    </Dialog>
  );
}

/** The fields and buttons of the dialog; also inside "Add to playlist". */
export function PlaylistForm({
  playlist,
  onCancel,
  onDone,
  withDescription = true,
}: {
  playlist?: PlaylistDetail;
  onCancel(): void;
  onDone(playlist: PlaylistDetail): void;
  withDescription?: boolean;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState(playlist?.name ?? "");
  const [description, setDescription] = useState(playlist?.description ?? "");
  const [empty, setEmpty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const body = { name: name.trim(), description: description.trim() || null };
    setEmpty(!body.name);
    if (!body.name) return;
    setBusy(true);
    setFailure(null);
    try {
      const saved = playlist
        ? await changePlaylist(queryClient, playlist.id, () =>
            unwrap(
              api.PATCH("/api/v1/playlists/{playlist_id}", {
                params: { path: { playlist_id: playlist.id } },
                body,
              }),
            ),
          )
        : await unwrap(api.POST("/api/v1/playlists", { body }));
      if (!playlist) {
        queryClient.setQueryData(playlistQuery(saved.id).queryKey, saved);
        void queryClient.invalidateQueries({ queryKey: playlistsQuery.queryKey, exact: true });
      }
      onDone(saved);
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  };

  return (
    <form className={styles.form} noValidate onSubmit={(event) => void onSubmit(event)}>
      {failure !== null && <Alert tone="error">{errorMessage(t, failure)}</Alert>}
      <TextField
        label={t.playlists.name}
        value={name}
        maxLength={256}
        autoComplete="off"
        required
        error={empty ? t.auth.validation.required : null}
        onChange={(event) => setName(event.target.value)}
      />
      {withDescription && (
        <TextArea
          label={t.playlists.description}
          note={t.common.optional}
          value={description}
          maxLength={4000}
          onChange={(event) => setDescription(event.target.value)}
        />
      )}
      <DialogButtons>
        <Button variant="secondary" onClick={onCancel}>
          {t.playlists.cancel}
        </Button>
        <Button
          type="submit"
          busyLabel={busy && (playlist ? t.playlists.saving : t.playlists.creating)}
        >
          {playlist ? t.playlists.save : t.playlists.create}
        </Button>
      </DialogButtons>
    </form>
  );
}
