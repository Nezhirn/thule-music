import { useInfiniteQuery } from "@tanstack/react-query";
import { Music } from "lucide-react";
import { useSearchParams } from "react-router";
import { FilterBar, NothingFiltered } from "../catalog/FilterBar";
import { filteredId, isFiltered, type Facet } from "../catalog/filters";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading } from "../catalog/PageStatus";
import { pick, TRACK_SORTS, tracksQuery } from "../catalog/queries";
import { SortSelect } from "../catalog/SortSelect";
import { TrackTable } from "../catalog/TrackTable";
import { useFilters } from "../catalog/useFilters";
import { useI18n } from "../i18n";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import styles from "./CatalogPage.module.css";

const FACETS: readonly Facet[] = ["artist", "album", "genre"];

/** All tracks, sorted and filtered by artist, album and genre; all kept in the address. */
export function TracksPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const sort = pick(params.get("sort"), TRACK_SORTS) ?? "added";
  const { filters, set, clear } = useFilters(FACETS);
  const tracks = useInfiniteQuery(tracksQuery(sort, filters));
  const total = tracks.data?.pages[0]?.total;
  return (
    <>
      <PageHeader title={t.nav.tracks}>{total !== undefined && t.catalog.tracks(total)}</PageHeader>
      <div className={styles.toolbar}>
        <SortSelect
          label={t.catalog.sort}
          value={sort}
          options={TRACK_SORTS}
          names={t.catalog.trackSorts}
          onChange={(value) =>
            setParams(
              (current) => {
                const next = new URLSearchParams(current);
                if (value === "added") next.delete("sort");
                else next.set("sort", value);
                return next;
              },
              { replace: true },
            )
          }
        />
        <FilterBar
          scope="tracks"
          facets={FACETS}
          filters={filters}
          onChange={set}
          onClear={clear}
        />
      </div>
      {tracks.isPending && <PageLoading />}
      {tracks.isError && !tracks.isFetchNextPageError && (
        <LoadError error={tracks.error} onRetry={() => void tracks.refetch()} />
      )}
      {total === 0 &&
        (isFiltered(filters) ? (
          <NothingFiltered onClear={clear} />
        ) : (
          <EmptyState icon={Music} title={t.catalog.noTracks} />
        ))}
      {tracks.data && total !== 0 && (
        <TrackTable
          tracks={tracks.data.pages.flatMap((page) => page.items)}
          label={t.nav.tracks}
          source={{ type: "tracks", id: filteredId(sort, filters) }}
          withAlbum
        />
      )}
      <LoadMore query={tracks} />
    </>
  );
}
