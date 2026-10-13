import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Disc3 } from "lucide-react";
import { useSearchParams } from "react-router";
import { AlbumCard } from "../catalog/AlbumCard";
import { GenreLinks } from "../catalog/GenreLinks";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading } from "../catalog/PageStatus";
import { ALBUM_SORTS, albumsQuery, genresQuery, pick, type AlbumSort } from "../catalog/queries";
import { SortSelect } from "../catalog/SortSelect";
import { useI18n } from "../i18n";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import grid from "../catalog/Grid.module.css";
import styles from "./CatalogPage.module.css";

/** All albums, sorted and filtered by genre; both kept in the address, so going back to the
 * list restores them. */
export function AlbumsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const sort = pick(params.get("sort"), ALBUM_SORTS) ?? "added";
  const genre = params.get("genre");
  const albums = useInfiniteQuery(albumsQuery(sort, genre));
  const genres = useQuery(genresQuery);

  const address = (change: { sort?: AlbumSort; genre?: string | null }) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(change)) {
      if (value && !(key === "sort" && value === "added")) next.set(key, value);
      else next.delete(key);
    }
    return next;
  };

  const total = albums.data?.pages[0]?.total;
  return (
    <>
      <PageHeader
        title={genre ?? t.nav.albums}
        documentTitle={genre ? `${genre} — ${t.nav.albums}` : t.nav.albums}
      >
        {total !== undefined && t.catalog.albums(total)}
      </PageHeader>
      <div className={styles.toolbar}>
        <SortSelect
          label={t.catalog.sort}
          value={sort}
          options={ALBUM_SORTS}
          names={t.catalog.albumSorts}
          onChange={(value) => setParams(address({ sort: value }), { replace: true })}
        />
        {genres.data && genres.data.length > 0 && (
          <GenreLinks
            label={t.catalog.genre}
            genres={genres.data.map((g) => g.name)}
            current={genre}
            all={t.catalog.allGenres}
            to={(g) => `?${address({ genre: g }).toString()}`}
          />
        )}
      </div>
      {albums.isPending && <PageLoading />}
      {albums.isError && <LoadError error={albums.error} onRetry={() => void albums.refetch()} />}
      {total === 0 && <EmptyState icon={Disc3} title={t.catalog.noAlbums} />}
      {albums.data && (
        <ul className={grid.grid}>
          {albums.data.pages.flatMap((page) =>
            page.items.map((album) => (
              <li key={album.id}>
                <AlbumCard album={album} />
              </li>
            )),
          )}
        </ul>
      )}
      <LoadMore query={albums} />
    </>
  );
}
