import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { SearchX } from "lucide-react";
import { useCallback, useId } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import type { Schemas } from "../api/client";
import { AlbumCard } from "../catalog/AlbumCard";
import { ArtistCard } from "../catalog/ArtistCard";
import { GenreLinks } from "../catalog/GenreLinks";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading, RefreshFailed } from "../catalog/PageStatus";
import { failedToLoad } from "../catalog/loaded";
import { genresQuery, pick } from "../catalog/queries";
import { Shelf } from "../catalog/Shelf";
import { TrackTable } from "../catalog/TrackTable";
import { useI18n, type Messages } from "../i18n";
import { PlaylistCard } from "../playlists/PlaylistCard";
import { playlistsQuery } from "../playlists/queries";
import { clean, fold, topResult } from "../search/match";
import {
  FEW,
  SEARCH_KINDS,
  searchKindQuery,
  searchQuery,
  type Found,
  type Results,
  type SearchKind,
} from "../search/queries";
import { SearchField } from "../search/SearchField";
import type { SearchState } from "../search/shortcut";
import { TopResult } from "../search/TopResult";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { Segmented } from "../ui/Segmented";
import grid from "../catalog/Grid.module.css";
import catalog from "./CatalogPage.module.css";
import styles from "./SearchPage.module.css";

type Playlist = Schemas["PlaylistOut"];

/** Tracks shown next to the top result; "See all" shows the rest. */
const TRACKS_SHOWN = 5;

/** The library searched as you type: the query and the kind of results shown are in the
 * address, so going back to the results finds them as they were. Nothing typed yet: genres
 * to browse. */
export function SearchPage() {
  const { t } = useI18n();
  const label = useId();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const query = clean(params.get("q") ?? "");
  const kind = pick(params.get("type"), SEARCH_KINDS);

  const onSearch = useCallback(
    (next: string) =>
      setParams(
        (current) => {
          const changed = new URLSearchParams(current);
          if (next) {
            changed.set("q", next);
          } else {
            // Nothing to search for: the next search starts with everything again.
            changed.delete("q");
            changed.delete("type");
          }
          return changed;
        },
        { replace: true },
      ),
    [setParams],
  );

  const everything = useQuery({
    ...searchQuery(query),
    enabled: query !== "" && kind === null,
    placeholderData: keepPreviousData,
  });
  const ofKind = useInfiniteQuery({
    ...searchKindQuery(query, kind ?? "tracks"),
    enabled: query !== "" && kind !== null,
    // The results of the query before, while they are of the same kind.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === kind ? previous : undefined,
  });
  const playlists = useQuery(playlistsQuery);
  const matching =
    query && playlists.data
      ? playlists.data.filter((playlist) => fold(playlist.name).includes(fold(query)))
      : [];

  const busy =
    query !== "" &&
    (kind === null ? everything.isFetching : ofKind.isFetching && !ofKind.isFetchingNextPage);
  // The field takes the focus on computers, or when a shortcut asked for it.
  const autoFocus =
    (location.state as SearchState | null)?.focusSearch === true ||
    window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  return (
    <>
      <PageHeader title={t.nav.search} />
      <SearchField query={query} onSearch={onSearch} busy={busy} autoFocus={autoFocus} />
      <p role="status" className="visually-hidden">
        {query && status(t, query, kind, everything, ofKind, matching)}
      </p>
      {query === "" ? (
        <Browse />
      ) : (
        <>
          <div className={catalog.toolbar}>
            <span id={label} className="visually-hidden">
              {t.search.show}
            </span>
            <Segmented
              labelledBy={label}
              options={[
                { value: "all", label: t.search.all },
                ...SEARCH_KINDS.map((value) => ({ value, label: t.search.kinds[value] })),
              ]}
              value={kind ?? "all"}
              onChange={(value) =>
                setParams(value === "all" ? { q: query } : { q: query, type: value }, {
                  replace: true,
                })
              }
            />
          </div>
          {kind === null ? (
            <Everything query={query} results={everything} playlists={matching} />
          ) : (
            <OfKind query={query} kind={kind} pages={ofKind} />
          )}
        </>
      )}
    </>
  );
}

/** What screen readers hear once the results are in. */
function status(
  t: Messages,
  query: string,
  kind: SearchKind | null,
  everything: UseQueryResult<Results>,
  ofKind: UseInfiniteQueryResult<InfiniteData<Found>>,
  playlists: Playlist[],
): string {
  if (kind === null) {
    if (!everything.isSuccess || everything.isPlaceholderData) return "";
    const { artists, albums, tracks } = everything.data;
    const parts = [
      artists.length > 0 && t.search.artists(artists.length),
      albums.length > 0 && t.catalog.albums(albums.length),
      tracks.length > 0 && t.catalog.tracks(tracks.length),
      playlists.length > 0 && t.search.playlistsFound(playlists.length),
    ].filter((part) => part !== false);
    return parts.length ? t.search.found(query, parts.join(", ")) : t.search.nothing(query);
  }
  if (!ofKind.isSuccess || ofKind.isPlaceholderData) return "";
  const n = ofKind.data.pages.reduce((sum, page) => sum + page[kind].length, 0);
  if (n === 0) return t.search.noKind[kind](query);
  const count = {
    tracks: t.catalog.tracks,
    albums: t.catalog.albums,
    artists: t.search.artists,
  }[kind](n);
  return t.search.found(query, count);
}

function Browse() {
  const { t } = useI18n();
  const genres = useQuery(genresQuery);
  if (!genres.data?.length) return null;
  return (
    <section className={catalog.section} aria-labelledby="browse-genres">
      <h2 id="browse-genres" className={catalog.heading}>
        {t.search.browse}
      </h2>
      <GenreLinks
        label={t.search.browse}
        genres={genres.data.map((genre) => genre.name)}
        wrap
        to={(genre) => `/albums?genre=${encodeURIComponent(genre ?? "")}`}
      />
    </section>
  );
}

const seeAll = (query: string, kind: SearchKind) =>
  `/search?${new URLSearchParams({ q: query, type: kind }).toString()}`;

/** A few of each kind: the top result and tracks, then artists, albums, playlists. */
function Everything({
  query,
  results,
  playlists,
}: {
  query: string;
  results: UseQueryResult<Results>;
  playlists: Playlist[];
}) {
  const { t } = useI18n();
  if (results.isPending) return <PageLoading />;
  if (failedToLoad(results)) {
    return <LoadError error={results.error} onRetry={() => void results.refetch()} />;
  }
  const { artists, albums, tracks } = results.data;
  if (!artists.length && !albums.length && !tracks.length && !playlists.length) {
    return (
      <EmptyState icon={SearchX} title={t.search.nothing(results.data.query)}>
        {t.search.nothingText}
      </EmptyState>
    );
  }
  const top = topResult(results.data.query, results.data);
  return (
    <div className={styles.results} aria-busy={results.isPlaceholderData || undefined}>
      {(top || tracks.length > 0) && (
        <div className={styles.lead}>
          {top && (
            <section aria-labelledby="search-top">
              <div className={styles.head}>
                <h2 id="search-top" className={styles.heading}>
                  {t.search.top}
                </h2>
              </div>
              <TopResult top={top} />
            </section>
          )}
          {tracks.length > 0 && (
            <section aria-labelledby="search-tracks">
              <div className={styles.head}>
                <h2 id="search-tracks" className={styles.heading}>
                  {t.search.kinds.tracks}
                </h2>
                {tracks.length > TRACKS_SHOWN && (
                  <Link to={seeAll(query, "tracks")} className={styles.more}>
                    {t.catalog.seeAll}
                  </Link>
                )}
              </div>
              <TrackTable
                tracks={tracks.slice(0, TRACKS_SHOWN)}
                queue={tracks}
                label={t.search.kinds.tracks}
                source={{ type: "search", id: results.data.query }}
                withAlbum
              />
            </section>
          )}
        </div>
      )}
      {artists.length > 0 && (
        <Shelf
          title={t.search.kinds.artists}
          more={artists.length >= FEW ? seeAll(query, "artists") : undefined}
        >
          {artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
          ))}
        </Shelf>
      )}
      {albums.length > 0 && (
        <Shelf
          title={t.search.kinds.albums}
          more={albums.length >= FEW ? seeAll(query, "albums") : undefined}
        >
          {albums.map((album) => (
            <AlbumCard key={album.id} album={album} />
          ))}
        </Shelf>
      )}
      {playlists.length > 0 && (
        <Shelf title={t.search.playlists}>
          {playlists.map((playlist) => (
            <PlaylistCard key={playlist.id} playlist={playlist} />
          ))}
        </Shelf>
      )}
    </div>
  );
}

/** Everything of one kind, loaded as the list scrolls. */
function OfKind({
  query,
  kind,
  pages,
}: {
  query: string;
  kind: SearchKind;
  pages: UseInfiniteQueryResult<InfiniteData<Found>>;
}) {
  const { t } = useI18n();
  if (pages.isPending) return <PageLoading />;
  if (failedToLoad(pages))
    return <LoadError error={pages.error} onRetry={() => void pages.refetch()} />;
  const all = pages.data.pages;
  const busy = pages.isPlaceholderData || undefined;
  let list;
  if (kind === "tracks") {
    const tracks = all.flatMap((page) => page.tracks);
    list = tracks.length > 0 && (
      <TrackTable
        tracks={tracks}
        label={t.search.kinds.tracks}
        source={{ type: "search", id: query }}
        withAlbum
      />
    );
  } else if (kind === "albums") {
    const albums = all.flatMap((page) => page.albums);
    list = albums.length > 0 && (
      <ul className={grid.grid} aria-label={t.search.kinds.albums}>
        {albums.map((album) => (
          <li key={album.id}>
            <AlbumCard album={album} />
          </li>
        ))}
      </ul>
    );
  } else {
    const artists = all.flatMap((page) => page.artists);
    list = artists.length > 0 && (
      <ul className={grid.grid} aria-label={t.search.kinds.artists}>
        {artists.map((artist) => (
          <li key={artist.id}>
            <ArtistCard artist={artist} />
          </li>
        ))}
      </ul>
    );
  }
  if (!list) {
    return (
      <EmptyState icon={SearchX} title={t.search.noKind[kind](query)}>
        {t.search.nothingText}
      </EmptyState>
    );
  }
  return (
    <div className={styles.results} aria-busy={busy}>
      <RefreshFailed query={pages} />
      {list}
      <LoadMore query={pages} />
    </div>
  );
}
