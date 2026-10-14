import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api } from "../api/client";
import { errorMessage, unwrap } from "../api/errors";
import { useI18n } from "../i18n";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { announce } from "../ui/toast";
import { AddContext, type Adding } from "./adding";
import { PlaylistCover } from "./PlaylistCover";
import { PlaylistForm } from "./PlaylistDialog";
import { changePlaylist, playlistsQuery, type PlaylistDetail } from "./queries";
import styles from "./playlists.module.css";
import { failedToLoad } from "../catalog/loaded";

/** The one "Add to playlist" dialog, for the menus of the pages inside. */
export function AddToPlaylistProvider({ children }: { children: ReactNode }) {
  const [adding, setAdding] = useState<Adding | null>(null);
  return (
    <AddContext value={setAdding}>
      {children}
      <AddToPlaylistDialog adding={adding} onClose={() => setAdding(null)} />
    </AddContext>
  );
}

function AddToPlaylistDialog({ adding, onClose }: { adding: Adding | null; onClose(): void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const close = () => {
    setCreating(false);
    onClose();
  };

  const add = (playlist: { id: string; name: string }) => {
    if (!adding) return;
    const { tracks, name } = adding;
    close();
    changePlaylist(queryClient, playlist.id, () =>
      unwrap(
        api.POST("/api/v1/playlists/{playlist_id}/tracks", {
          params: { path: { playlist_id: playlist.id } },
          body: { track_ids: tracks.map((track) => track.id) },
        }),
      ),
    ).then(
      () => announce(t.playlists.added(name, playlist.name)),
      (error: unknown) => announce(t.playlists.failed(errorMessage(t, error))),
    );
  };

  return (
    <Dialog
      open={adding !== null}
      onClose={close}
      title={creating ? t.playlists.new : t.playlists.addTo}
      description={adding && t.playlists.adding(adding.name)}
    >
      {creating ? (
        <PlaylistForm
          withDescription={false}
          onCancel={() => setCreating(false)}
          onDone={(created: PlaylistDetail) => add(created)}
        />
      ) : (
        <Choices onNew={() => setCreating(true)} onPick={add} onCancel={close} />
      )}
    </Dialog>
  );
}

function Choices({
  onNew,
  onPick,
  onCancel,
}: {
  onNew(): void;
  onPick(playlist: { id: string; name: string }): void;
  onCancel(): void;
}) {
  const { t } = useI18n();
  const playlists = useQuery(playlistsQuery);
  return (
    <>
      <Button variant="secondary" onClick={onNew}>
        <Plus aria-hidden="true" className={styles.plus} />
        {t.playlists.new}
      </Button>
      {playlists.isPending && <p className={styles.note}>{t.common.loading}</p>}
      {failedToLoad(playlists) && <p className={styles.note}>{t.nav.playlistsFailed}</p>}
      {playlists.data && playlists.data.length > 0 && (
        <ul className={styles.choices} aria-label={t.nav.playlists}>
          {playlists.data.map((playlist) => (
            <li key={playlist.id}>
              <button type="button" className={styles.choice} onClick={() => onPick(playlist)}>
                <PlaylistCover ids={playlist.cover_ids} sizes="44px" small />
                <span className={styles.choiceText}>
                  <span className={styles.choiceName}>{playlist.name}</span>
                  <span className={styles.choiceCount}>
                    {t.catalog.tracks(playlist.track_count)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.end}>
        <Button variant="secondary" onClick={onCancel}>
          {t.playlists.cancel}
        </Button>
      </div>
    </>
  );
}
