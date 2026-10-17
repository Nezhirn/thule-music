import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Disc3, FolderInput, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router";
import { AlbumCard } from "../catalog/AlbumCard";
import { FilterBar, NothingFiltered } from "../catalog/FilterBar";
import { isFiltered, type Facet } from "../catalog/filters";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading } from "../catalog/PageStatus";
import { ALBUM_SORTS, albumsQuery, genresQuery, pick } from "../catalog/queries";
import { SortSelect } from "../catalog/SortSelect";
import { useFilters } from "../catalog/useFilters";
import { useEdits } from "../edits/context";
import { useI18n } from "../i18n";
import { EmptyState } from "../ui/EmptyState";
import iconButton from "../ui/IconButton.module.css";
import { Menu, MenuItem } from "../ui/Menu";
import { PageHeader } from "../ui/PageHeader";
import grid from "../catalog/Grid.module.css";
import styles from "./CatalogPage.module.css";

const FACETS: readonly Facet[] = ["artist", "genre"];

/** All albums, sorted and filtered by artist and genre; all kept in the address, so going
 * back to the list restores them. Filtered by a genre alone, it is that genre's page. */
export function AlbumsPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const sort = pick(params.get("sort"), ALBUM_SORTS) ?? "added";
  const { filters, set, clear } = useFilters(FACETS);
  const { genre } = filters;
  const albums = useInfiniteQuery(albumsQuery(sort, filters));
  const genres = useQuery(genresQuery);
  const edits = useEdits();

  const total = albums.data?.pages[0]?.total;
  // The genre as the list spells it, with all its albums (whoever they are by).
  const found = genres.data?.find((g) => g.name.toLowerCase() === genre?.toLowerCase());
  // Its actions act on all its albums: offered on its own page, not on some of them.
  const subject =
    found && !filters.artist ? { name: found.name, albumCount: found.album_count } : null;
  return (
    <>
      <PageHeader
        title={found?.name ?? genre ?? t.nav.albums}
        documentTitle={genre ? `${found?.name ?? genre} — ${t.nav.albums}` : t.nav.albums}
        actions={
          edits &&
          subject && (
            <Menu
              label={t.player.trackActions(subject.name)}
              trigger={<MoreHorizontal className={iconButton.icon} />}
              triggerClassName={`${iconButton.button} ${iconButton.md}`}
            >
              <MenuItem icon={Pencil} onSelect={() => edits.renameGenre(subject)}>
                {t.edits.renameGenre}
              </MenuItem>
              <MenuItem
                icon={FolderInput}
                onSelect={() => edits.moveAlbums({ kind: "genre", genre: subject })}
              >
                {t.edits.moveAlbums}
              </MenuItem>
              <MenuItem icon={Trash2} onSelect={() => edits.deleteGenre(subject)}>
                {t.edits.deleteGenre}
              </MenuItem>
            </Menu>
          )
        }
      >
        {total !== undefined && t.catalog.albums(total)}
      </PageHeader>
      <div className={styles.toolbar}>
        <SortSelect
          label={t.catalog.sort}
          value={sort}
          options={ALBUM_SORTS}
          names={t.catalog.albumSorts}
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
          scope="albums"
          facets={FACETS}
          filters={filters}
          onChange={set}
          onClear={clear}
        />
      </div>
      {albums.isPending && <PageLoading />}
      {albums.isError && !albums.isFetchNextPageError && (
        <LoadError error={albums.error} onRetry={() => void albums.refetch()} />
      )}
      {total === 0 &&
        (isFiltered(filters) ? (
          <NothingFiltered onClear={clear} />
        ) : (
          <EmptyState icon={Disc3} title={t.catalog.noAlbums} />
        ))}
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
