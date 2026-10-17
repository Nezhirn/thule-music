import { useInfiniteQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { useId } from "react";
import { useSearchParams } from "react-router";
import { AlbumCard } from "../catalog/AlbumCard";
import { ArtistCard } from "../catalog/ArtistCard";
import { FilterBar, NothingFiltered } from "../catalog/FilterBar";
import { isFiltered, type Facet, type Filters } from "../catalog/filters";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading, RefreshFailed } from "../catalog/PageStatus";
import { failedToLoad } from "../catalog/loaded";
import { useFilters } from "../catalog/useFilters";
import { useI18n } from "../i18n";
import { favouriteAlbumsQuery, favouriteArtistsQuery } from "../likes/queries";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
import grid from "../catalog/Grid.module.css";
import styles from "./CatalogPage.module.css";

type Shown = "albums" | "artists";

const FACETS: Record<Shown, readonly Facet[]> = {
  albums: ["artist", "genre"],
  artists: ["genre"],
};

/** Favourite albums or artists (which, in the address, with their filters), newest first. */
export function FavoritesPage() {
  const { t } = useI18n();
  const label = useId();
  const [params, setParams] = useSearchParams();
  const shown: Shown = params.get("show") === "artists" ? "artists" : "albums";
  const { filters, set, clear } = useFilters(FACETS[shown]);
  return (
    <>
      <PageHeader title={t.nav.favorites} />
      <div className={styles.toolbar}>
        <span id={label} className="visually-hidden">
          {t.likes.show}
        </span>
        <Segmented
          labelledBy={label}
          options={[
            { value: "albums", label: t.likes.albums },
            { value: "artists", label: t.likes.artists },
          ]}
          value={shown}
          onChange={(value) =>
            // A genre is one of both; an artist isn't.
            setParams(
              {
                ...(value === "artists" && { show: value }),
                ...(filters.genre && { genre: filters.genre }),
              },
              { replace: true },
            )
          }
        />
        <FilterBar
          scope={shown === "albums" ? "liked_albums" : "liked_artists"}
          facets={FACETS[shown]}
          filters={filters}
          onChange={set}
          onClear={clear}
        />
      </div>
      {shown === "albums" ? (
        <Albums filters={filters} onClear={clear} />
      ) : (
        <Artists filters={filters} onClear={clear} />
      )}
    </>
  );
}

interface ListProps {
  filters: Filters;
  onClear(): void;
}

function Albums({ filters, onClear }: ListProps) {
  const { t } = useI18n();
  const albums = useInfiniteQuery(favouriteAlbumsQuery(filters));
  if (albums.isPending) return <PageLoading />;
  if (failedToLoad(albums)) {
    return <LoadError error={albums.error} onRetry={() => void albums.refetch()} />;
  }
  if (albums.data.pages[0]?.total === 0) {
    if (isFiltered(filters)) return <NothingFiltered onClear={onClear} />;
    return (
      <EmptyState icon={Star} title={t.likes.noAlbums}>
        {t.likes.noAlbumsText}
      </EmptyState>
    );
  }
  return (
    <>
      <RefreshFailed query={albums} />
      <ul className={grid.grid} aria-label={t.likes.albums}>
        {albums.data.pages.flatMap((page) =>
          page.items.map((album) => (
            <li key={album.id}>
              <AlbumCard album={album} />
            </li>
          )),
        )}
      </ul>
      <LoadMore query={albums} />
    </>
  );
}

function Artists({ filters, onClear }: ListProps) {
  const { t } = useI18n();
  const artists = useInfiniteQuery(favouriteArtistsQuery(filters));
  if (artists.isPending) return <PageLoading />;
  if (failedToLoad(artists)) {
    return <LoadError error={artists.error} onRetry={() => void artists.refetch()} />;
  }
  if (artists.data.pages[0]?.total === 0) {
    if (isFiltered(filters)) return <NothingFiltered onClear={onClear} />;
    return (
      <EmptyState icon={Star} title={t.likes.noArtists}>
        {t.likes.noArtistsText}
      </EmptyState>
    );
  }
  return (
    <>
      <RefreshFailed query={artists} />
      <ul className={grid.grid} aria-label={t.likes.artists}>
        {artists.data.pages.flatMap((page) =>
          page.items.map((artist) => (
            <li key={artist.id}>
              <ArtistCard artist={artist} />
            </li>
          )),
        )}
      </ul>
      <LoadMore query={artists} />
    </>
  );
}
