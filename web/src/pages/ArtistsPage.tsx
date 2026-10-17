import { useInfiniteQuery } from "@tanstack/react-query";
import { MicVocal } from "lucide-react";
import { ArtistCard } from "../catalog/ArtistCard";
import { FilterBar, NothingFiltered } from "../catalog/FilterBar";
import { isFiltered, type Facet } from "../catalog/filters";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading } from "../catalog/PageStatus";
import { artistsQuery } from "../catalog/queries";
import { useFilters } from "../catalog/useFilters";
import { useI18n } from "../i18n";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import grid from "../catalog/Grid.module.css";
import styles from "./CatalogPage.module.css";

const FACETS: readonly Facet[] = ["genre"];

/** All artists, A to Z; filtered by genre (kept in the address). */
export function ArtistsPage() {
  const { t } = useI18n();
  const { filters, set, clear } = useFilters(FACETS);
  const artists = useInfiniteQuery(artistsQuery(filters));
  const total = artists.data?.pages[0]?.total;
  return (
    <>
      <PageHeader title={t.nav.artists} />
      <div className={styles.toolbar}>
        <FilterBar
          scope="artists"
          facets={FACETS}
          filters={filters}
          onChange={set}
          onClear={clear}
        />
      </div>
      {artists.isPending && <PageLoading />}
      {artists.isError && !artists.isFetchNextPageError && (
        <LoadError error={artists.error} onRetry={() => void artists.refetch()} />
      )}
      {total === 0 &&
        (isFiltered(filters) ? (
          <NothingFiltered onClear={clear} />
        ) : (
          <EmptyState icon={MicVocal} title={t.catalog.noArtists} />
        ))}
      {artists.data && (
        <ul className={grid.grid}>
          {artists.data.pages.flatMap((page) =>
            page.items.map((artist) => (
              <li key={artist.id}>
                <ArtistCard artist={artist} />
              </li>
            )),
          )}
        </ul>
      )}
      <LoadMore query={artists} />
    </>
  );
}
