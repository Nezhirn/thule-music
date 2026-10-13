import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { errorMessage } from "../api/errors";
import { LoadError } from "../catalog/LoadError";
import { PageLoading } from "../catalog/PageStatus";
import type { Album } from "../catalog/queries";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import type { AlbumsMoveSubject } from "./context";
import { AlbumChecklist, ArtistPicker, GenrePicker } from "./Pickers";
import { genreAlbumsQuery, useMoveAlbums, useSetAlbumsGenre } from "./queries";
import styles from "./edits.module.css";

/** Moves an artist's albums to another artist, or a genre's albums into another genre: in
 * their tracks' tags. */
export function MoveAlbumsDialog({
  subject,
  onClose,
}: {
  subject: AlbumsMoveSubject | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  let description: string | undefined;
  let key = "";
  if (subject?.kind === "artist") [description, key] = [subject.artist.name, subject.artist.id];
  else if (subject) [description, key] = [subject.genre.name, `genre:${subject.genre.name}`];
  return (
    <Dialog
      open={subject !== null}
      onClose={onClose}
      title={t.edits.moveAlbumsDialog.title}
      description={description}
      wide
    >
      {subject?.kind === "artist" && (
        <MoveForm key={key} subject={subject} albums={subject.artist.albums} onClose={onClose} />
      )}
      {subject?.kind === "genre" && <GenreAlbums key={key} subject={subject} onClose={onClose} />}
    </Dialog>
  );
}

/** The genre's albums, all of them, before there is a choice to make. */
function GenreAlbums({
  subject,
  onClose,
}: {
  subject: Extract<AlbumsMoveSubject, { kind: "genre" }>;
  onClose(): void;
}) {
  const albums = useQuery(genreAlbumsQuery(subject.genre.name));
  if (albums.isPending) return <PageLoading />;
  if (albums.isError) {
    return <LoadError error={albums.error} onRetry={() => void albums.refetch()} />;
  }
  return <MoveForm subject={subject} albums={albums.data} onClose={onClose} />;
}

function MoveForm({
  subject,
  albums,
  onClose,
}: {
  subject: AlbumsMoveSubject;
  albums: Album[];
  onClose(): void;
}) {
  const { t } = useI18n();
  const text = t.edits.moveAlbumsDialog;
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const toArtist = useMoveAlbums();
  const toGenre = useSetAlbumsGenre();
  const move = subject.kind === "artist" ? toArtist : toGenre;
  // A single album has no choice to make: it is the one.
  const [selected, setSelected] = useState(
    () => new Set(albums.length === 1 ? albums.map((album) => album.id) : []),
  );
  const [target, setTarget] = useState<string | null>(null);
  const ready = selected.size > 0 && target !== null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    const album_ids = albums.filter((album) => selected.has(album.id)).map((album) => album.id);
    // Everything shown moved away: the page shows where it went.
    const all = album_ids.length === albums.length;
    if (subject.kind === "artist") {
      const { artist } = subject;
      toArtist.mutate(
        { album_ids, artist: target },
        {
          onSuccess: (to) => {
            onClose();
            // The artist is gone when nothing of theirs is left.
            const gone = all && artist.appears_on.length === 0;
            if (pathname === `/artists/${artist.id}` && gone) {
              void navigate(`/artists/${to.id}`, { replace: true });
            }
          },
        },
      );
    } else {
      toGenre.mutate(
        { album_ids, genre: target },
        {
          onSuccess: (to) => {
            onClose();
            const shown = new URLSearchParams(search).get("genre");
            if (
              pathname === "/albums" &&
              all &&
              shown?.toLowerCase() === subject.genre.name.toLowerCase()
            ) {
              const next = new URLSearchParams(search);
              next.set("genre", to.name);
              void navigate(`/albums?${next.toString()}`, { replace: true });
            }
          },
        },
      );
    }
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <AlbumChecklist albums={albums} selected={selected} onChange={setSelected} />
      {subject.kind === "artist" ? (
        <ArtistPicker
          legend={t.edits.pick.toArtist}
          exclude={subject.artist.id}
          allowNew
          onChange={setTarget}
        />
      ) : (
        <GenrePicker exclude={subject.genre.name} onChange={setTarget} />
      )}
      <p className={styles.hint}>{subject.kind === "artist" ? text.artistNote : text.genreNote}</p>
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
