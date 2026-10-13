import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ListMusic, ListX, Pencil, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../api/client";
import { errorMessage, unwrap } from "../api/errors";
import { DetailHeader } from "../catalog/DetailHeader";
import { PageFailed, PageLoading } from "../catalog/PageStatus";
import { TrackTable } from "../catalog/TrackTable";
import { useI18n } from "../i18n";
import { usePlayerControls } from "../player/context";
import { PlayButton } from "../player/PlayButton";
import { CollectionActions } from "../player/TrackActions";
import { PlaylistCover } from "../playlists/PlaylistCover";
import { PlaylistDialog } from "../playlists/PlaylistDialog";
import {
  changePlaylist,
  moveItem,
  playlistQuery,
  playlistsQuery,
  withItems,
  type PlaylistDetail,
} from "../playlists/queries";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import { EmptyState } from "../ui/EmptyState";
import { IconButton } from "../ui/IconButton";
import { MenuItem } from "../ui/Menu";
import { announce } from "../ui/toast";

export function PlaylistPage() {
  const { id = "" } = useParams();
  // Another playlist starts afresh: no dialog left open from the last one.
  return <Playlist key={id} id={id} />;
}

function Playlist({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useQuery(playlistQuery(id));
  const queryClient = useQueryClient();
  const player = usePlayerControls();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const table = useRef<HTMLDivElement>(null);
  // The row whose menu button gets the focus once the playlist shows a change made from a
  // menu: the moved row, or the one in the place of a removed row.
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    const key = refocus.current;
    const button =
      key && table.current?.querySelector<HTMLElement>(`[data-key="${key}"] [aria-haspopup]`);
    if (!button) return;
    refocus.current = null;
    button.focus();
  }, [query.data]);

  if (query.isPending) return <PageLoading />;
  if (query.isError) {
    return (
      <PageFailed
        error={query.error}
        notFound={t.errors.playlist_not_found}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const playlist = query.data;
  const tracks = playlist.items.map((item) => item.track);
  const source = { type: "playlist", id: playlist.id } as const;
  const failed = (error: unknown) => announce(t.playlists.failed(errorMessage(t, error)));

  const move = (from: number, to: number) => {
    const item = playlist.items[from];
    if (!item) return;
    changePlaylist(
      queryClient,
      playlist.id,
      () =>
        unwrap(
          api.POST("/api/v1/playlists/{playlist_id}/move", {
            params: { path: { playlist_id: playlist.id } },
            body: { item_id: item.item_id, position: to },
          }),
        ),
      (current) => {
        const at = current.items.findIndex((other) => other.item_id === item.item_id);
        return at === -1 ? current : moveItem(current, at, to);
      },
    ).catch(failed);
  };
  const remove = (index: number) => {
    const item = playlist.items[index];
    if (!item) return;
    refocus.current = (playlist.items[index + 1] ?? playlist.items[index - 1])?.item_id ?? null;
    changePlaylist(
      queryClient,
      playlist.id,
      () =>
        unwrap(
          api.DELETE("/api/v1/playlists/{playlist_id}/tracks/{item_id}", {
            params: { path: { playlist_id: playlist.id, item_id: item.item_id } },
          }),
        ),
      (current) =>
        withItems(
          current,
          current.items.filter((other) => other.item_id !== item.item_id),
        ),
    ).then(() => announce(t.playlists.removed(item.track.title, playlist.name)), failed);
  };

  return (
    <>
      <DetailHeader
        kind={t.playlists.playlist}
        title={playlist.name}
        description={playlist.description}
        palette={tracks[0]?.album.cover_palette ?? null}
        art={<PlaylistCover ids={playlist.cover_ids} sizes="(max-width: 899px) 64vw, 232px" />}
        actions={
          <>
            {tracks.length > 0 && (
              <>
                <PlayButton source={source} name={playlist.name} tracks={() => tracks} />
                <IconButton
                  icon={Shuffle}
                  label={t.player.shuffleItem(playlist.name)}
                  onClick={() => player.play(tracks, { shuffle: true, source })}
                />
              </>
            )}
            <CollectionActions name={playlist.name} tracks={tracks}>
              <MenuItem icon={Pencil} onSelect={() => setEditing(true)}>
                {t.playlists.edit}
              </MenuItem>
              <MenuItem icon={Trash2} onSelect={() => setDeleting(true)}>
                {t.playlists.delete}
              </MenuItem>
            </CollectionActions>
          </>
        }
      >
        <span>
          {t.catalog.tracks(tracks.length)}
          {tracks.length > 0 && `, ${t.catalog.length(playlist.duration_ms)}`}
        </span>
      </DetailHeader>
      {tracks.length === 0 ? (
        <EmptyState icon={ListMusic} title={t.playlists.empty}>
          {t.playlists.emptyText}
        </EmptyState>
      ) : (
        <div ref={table}>
          <TrackTable
            tracks={tracks}
            keys={playlist.items.map((item) => item.item_id)}
            label={playlist.name}
            source={source}
            numbers="position"
            withAlbum
            onMove={move}
            actions={(index) => (
              <>
                {index > 0 && (
                  <MenuItem
                    icon={ArrowUp}
                    onSelect={() => {
                      refocus.current = playlist.items[index]!.item_id;
                      move(index, index - 1);
                    }}
                  >
                    {t.playlists.moveUp}
                  </MenuItem>
                )}
                {index < tracks.length - 1 && (
                  <MenuItem
                    icon={ArrowDown}
                    onSelect={() => {
                      refocus.current = playlist.items[index]!.item_id;
                      move(index, index + 1);
                    }}
                  >
                    {t.playlists.moveDown}
                  </MenuItem>
                )}
                <MenuItem icon={ListX} onSelect={() => remove(index)}>
                  {t.playlists.remove}
                </MenuItem>
              </>
            )}
          />
        </div>
      )}
      <PlaylistDialog
        open={editing}
        playlist={playlist}
        onClose={() => setEditing(false)}
        onDone={() => setEditing(false)}
      />
      <DeleteDialog playlist={playlist} open={deleting} onClose={() => setDeleting(false)} />
    </>
  );
}

function DeleteDialog({
  playlist,
  open,
  onClose,
}: {
  playlist: PlaylistDetail;
  open: boolean;
  onClose(): void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await unwrap(
        api.DELETE("/api/v1/playlists/{playlist_id}", {
          params: { path: { playlist_id: playlist.id } },
        }),
      );
    } catch (error) {
      setBusy(false);
      onClose();
      announce(t.playlists.failed(errorMessage(t, error)));
      return;
    }
    announce(t.playlists.deleted(playlist.name));
    void navigate("/", { replace: true });
    queryClient.removeQueries({ queryKey: playlistQuery(playlist.id).queryKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: playlistsQuery.queryKey, exact: true });
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.playlists.deleteTitle(playlist.name)}
      description={t.playlists.deleteText}
    >
      <DialogButtons>
        <Button variant="secondary" onClick={onClose}>
          {t.playlists.cancel}
        </Button>
        <Button busyLabel={busy && t.playlists.deleting} onClick={() => void confirm()}>
          {t.playlists.deleteConfirm}
        </Button>
      </DialogButtons>
    </Dialog>
  );
}
