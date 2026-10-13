import { useInfiniteQuery } from "@tanstack/react-query";
import { Heart, Shuffle } from "lucide-react";
import { DetailHeader } from "../catalog/DetailHeader";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading } from "../catalog/PageStatus";
import { TrackTable } from "../catalog/TrackTable";
import { useI18n } from "../i18n";
import { allLikedTracks, likedTracksQuery } from "../likes/queries";
import { usePlayerControls } from "../player/context";
import { PlayButton } from "../player/PlayButton";
import type { Source } from "../player/player";
import { EmptyState } from "../ui/EmptyState";
import { IconButton } from "../ui/IconButton";
import styles from "./CollectionPage.module.css";

const SOURCE: Source = { type: "liked", id: "liked" };

/** Liked songs, newest first. The buttons in the header play all of them; a row plays the
 * ones shown. */
export function LikedPage() {
  const { t } = useI18n();
  const player = usePlayerControls();
  const liked = useInfiniteQuery(likedTracksQuery);
  const total = liked.data?.pages[0]?.total;
  const tracks = liked.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <>
      <DetailHeader
        kind={t.likes.playlist}
        title={t.nav.liked}
        palette={null}
        art={
          <span className={styles.art}>
            <Heart />
          </span>
        }
        actions={
          Boolean(total) && (
            <>
              <PlayButton source={SOURCE} name={t.nav.liked} tracks={allLikedTracks} />
              <IconButton
                icon={Shuffle}
                label={t.player.shuffleItem(t.nav.liked)}
                onClick={() =>
                  void allLikedTracks().then(
                    (all) => player.play(all, { shuffle: true, source: SOURCE }),
                    () => {},
                  )
                }
              />
            </>
          )
        }
      >
        {total !== undefined && <span>{t.catalog.tracks(total)}</span>}
      </DetailHeader>
      {liked.isPending && <PageLoading />}
      {liked.isError && <LoadError error={liked.error} onRetry={() => void liked.refetch()} />}
      {total === 0 && (
        <EmptyState icon={Heart} title={t.likes.noLiked}>
          {t.likes.noLikedText}
        </EmptyState>
      )}
      {tracks.length > 0 && (
        <TrackTable tracks={tracks} label={t.nav.liked} source={SOURCE} withAlbum />
      )}
      <LoadMore query={liked} />
    </>
  );
}
