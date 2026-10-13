import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useMe } from "../account/me";
import { sendToAlbum } from "../admin/send";
import { useSession } from "../auth/session";
import type { Schemas } from "../api/client";
import type { Album, Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { announce } from "../ui/toast";
import { AlbumDialog } from "./AlbumDialog";
import { createAlbumUploads } from "./albumUploads";
import { ArtistDialog } from "./ArtistDialog";
import { CoverDialog } from "./CoverDialog";
import {
  EditsContext,
  type AlbumsMoveSubject,
  type CoverSubject,
  type Edits,
  type GenreSubject,
  type MoveSubject,
} from "./context";
import {
  DeleteAlbumDialog,
  DeleteArtistDialog,
  DeleteGenreDialog,
  DeleteTrackDialog,
} from "./DeleteDialogs";
import { GenreDialog } from "./GenreDialog";
import { LyricsDialog } from "./LyricsDialog";
import { MoveAlbumsDialog } from "./MoveAlbumsDialog";
import { MoveDialog } from "./MoveDialog";
import { libraryEdited } from "./queries";
import { TrackDialog } from "./TrackDialog";
import { ArtistUploadDialog, UploadDialog } from "./UploadDialog";

/** The dialog open, with what it is about. */
type Editing =
  | { kind: "lyrics"; track: Track }
  | { kind: "cover"; subject: CoverSubject }
  | { kind: "album"; album: Album }
  | { kind: "upload"; album: Album }
  | { kind: "deleteAlbum"; album: Album; tracks: Track[] }
  | { kind: "track"; track: Track }
  | { kind: "move"; subject: MoveSubject }
  | { kind: "deleteTrack"; track: Track }
  | { kind: "artist"; artist: Schemas["ArtistRef"] }
  | { kind: "artistUpload"; artist: Schemas["ArtistRef"] }
  | { kind: "moveAlbums"; subject: AlbumsMoveSubject }
  | { kind: "deleteArtist"; artist: Schemas["ArtistDetail"] }
  | { kind: "genre"; genre: GenreSubject }
  | { kind: "deleteGenre"; genre: GenreSubject };

/** The dialogs in which admins manage the library, for the menus of the pages inside. */
export function EditsProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const admin = useMe()?.role === "admin";
  const queryClient = useQueryClient();
  const { status } = useSession();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [edits] = useState<Edits>(() => ({
    editLyrics: (track) => setEditing({ kind: "lyrics", track }),
    editCover: (subject) => setEditing({ kind: "cover", subject }),
    editAlbum: (album) => setEditing({ kind: "album", album }),
    uploadToAlbum: (album) => setEditing({ kind: "upload", album }),
    deleteAlbum: (album, tracks) => setEditing({ kind: "deleteAlbum", album, tracks }),
    editTrack: (track) => setEditing({ kind: "track", track }),
    moveTracks: (subject) => setEditing({ kind: "move", subject }),
    deleteTrack: (track) => setEditing({ kind: "deleteTrack", track }),
    renameArtist: (artist) => setEditing({ kind: "artist", artist }),
    uploadToArtist: (artist) => setEditing({ kind: "artistUpload", artist }),
    moveAlbums: (subject) => setEditing({ kind: "moveAlbums", subject }),
    deleteArtist: (artist) => setEditing({ kind: "deleteArtist", artist }),
    renameGenre: (genre) => setEditing({ kind: "genre", genre }),
    deleteGenre: (genre) => setEditing({ kind: "deleteGenre", genre }),
    uploads: createAlbumUploads({ send: sendToAlbum }),
  }));
  // Once the uploads into albums are all done, wherever the admin is in the app.
  useEffect(
    () =>
      edits.uploads.store.subscribe(({ finished }, previous) => {
        if (!finished || finished === previous.finished) return;
        libraryEdited(queryClient);
        if (finished.added > 0) announce(t.edits.upload.done(finished.added));
      }),
    [edits, queryClient, t],
  );
  useEffect(() => {
    if (status === "anonymous") edits.uploads.reset();
  }, [edits, status]);

  const close = () => setEditing(null);
  const of = <K extends Editing["kind"]>(kind: K) =>
    editing?.kind === kind ? (editing as Extract<Editing, { kind: K }>) : null;
  return (
    <EditsContext value={admin ? edits : null}>
      {children}
      {admin && (
        <>
          <LyricsDialog track={of("lyrics")?.track ?? null} onClose={close} />
          <CoverDialog subject={of("cover")?.subject ?? null} onClose={close} />
          <AlbumDialog album={of("album")?.album ?? null} onClose={close} />
          <UploadDialog album={of("upload")?.album ?? null} onClose={close} />
          <DeleteAlbumDialog subject={of("deleteAlbum")} onClose={close} />
          <TrackDialog track={of("track")?.track ?? null} onClose={close} />
          <MoveDialog subject={of("move")?.subject ?? null} onClose={close} />
          <DeleteTrackDialog track={of("deleteTrack")?.track ?? null} onClose={close} />
          <ArtistDialog artist={of("artist")?.artist ?? null} onClose={close} />
          <ArtistUploadDialog artist={of("artistUpload")?.artist ?? null} onClose={close} />
          <MoveAlbumsDialog subject={of("moveAlbums")?.subject ?? null} onClose={close} />
          <DeleteArtistDialog artist={of("deleteArtist")?.artist ?? null} onClose={close} />
          <GenreDialog genre={of("genre")?.genre ?? null} onClose={close} />
          <DeleteGenreDialog genre={of("deleteGenre")?.genre ?? null} onClose={close} />
        </>
      )}
    </EditsContext>
  );
}
