import { useInfiniteQuery } from "@tanstack/react-query";
import { Heart, Shuffle } from "lucide-react";
import { DetailHeader } from "../catalog/DetailHeader";
import { FilterBar, NothingFiltered } from "../catalog/FilterBar";
import { filteredId, isFiltered, type Facet } from "../catalog/filters";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading } from "../catalog/PageStatus";
import { TrackTable } from "../catalog/TrackTable";
import { useFilters } from "../catalog/useFilters";
import { useI18n } from "../i18n";
import { allLikedTracks, likedTracksQuery } from "../likes/queries";
import { usePlayerControls } from "../player/context";
import { PlayButton } from "../player/PlayButton";
import type { Source } from "../player/player";
import { EmptyState } from "../ui/EmptyState";
import { IconButton } from "../ui/IconButton";
import catalog from "./CatalogPage.module.css";
import styles from "./CollectionPage.module.css";

const FACETS: readonly Facet[] = ["artist", "album", "genre"];

/** Liked songs, newest first, filtered by artist, album and genre (kept in the address). The
 * buttons in the header play all those the filters leave; a row plays the ones shown. */
export function LikedPage() {
  const { t } = useI18n();
  const player = usePlayerControls();
  const { filters, set, clear } = useFilters(FACETS);
  const liked = useInfiniteQuery(likedTracksQuery(filters));
  const total = liked.data?.pages[0]?.total;
  const tracks = liked.data?.pages.flatMap((page) => page.items) ?? [];
  const source: Source = { type: "liked", id: filteredId("liked", filters) };
  const all = () => allLikedTracks(filters);
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
              <PlayButton source={source} name={t.nav.liked} tracks={all} />
              <IconButton
                icon={Shuffle}
                label={t.player.shuffleItem(t.nav.liked)}
                onClick={() =>
                  void all().then(
                    (found) => player.play(found, { shuffle: true, source }),
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
      <div className={catalog.toolbar}>
        <FilterBar
          scope="liked_tracks"
          facets={FACETS}
          filters={filters}
          onChange={set}
          onClear={clear}
        />
      </div>
      {liked.isPending && <PageLoading />}
      {liked.isError && !liked.isFetchNextPageError && (
        <LoadError error={liked.error} onRetry={() => void liked.refetch()} />
      )}
      {total === 0 &&
        (isFiltered(filters) ? (
          <NothingFiltered onClear={clear} />
        ) : (
          <EmptyState icon={Heart} title={t.likes.noLiked}>
            {t.likes.noLikedText}
          </EmptyState>
        ))}
      {tracks.length > 0 && (
        <TrackTable tracks={tracks} label={t.nav.liked} source={source} withAlbum />
      )}
      <LoadMore query={liked} />
    </>
  );
}
