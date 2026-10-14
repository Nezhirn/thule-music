import { useQuery } from "@tanstack/react-query";
import { Disc3 } from "lucide-react";
import { displayName, useMe } from "../account/me";
import { AlbumCard } from "../catalog/AlbumCard";
import { GenreLinks } from "../catalog/GenreLinks";
import { LoadError } from "../catalog/LoadError";
import { NewAlbum } from "../catalog/NewAlbum";
import { PageLoading, RefreshFailed } from "../catalog/PageStatus";
import { failedToLoad } from "../catalog/loaded";
import { genresQuery, homeQuery, type Album } from "../catalog/queries";
import { Shelf } from "../catalog/Shelf";
import { useI18n } from "../i18n";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import styles from "./CatalogPage.module.css";

type PartOfDay = "morning" | "afternoon" | "evening" | "night";

function partOfDay(date: Date): PartOfDay {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 23) return "evening";
  return "night";
}

// Genres offered as shortcuts: the biggest ones.
const GENRES = 12;

export function HomePage() {
  const { t } = useI18n();
  const me = useMe();
  const home = useQuery(homeQuery);
  const genres = useQuery(genresQuery);
  if (!me) return null;
  const header = (
    <PageHeader
      title={t.home.greeting[partOfDay(new Date())](displayName(me))}
      documentTitle={t.nav.home}
    />
  );
  if (home.isPending) {
    return (
      <>
        {header}
        <PageLoading />
      </>
    );
  }
  if (failedToLoad(home)) {
    return (
      <>
        {header}
        <LoadError error={home.error} onRetry={() => void home.refetch()} />
      </>
    );
  }
  const { recently_added, for_you, recently_played, new_releases } = home.data;
  if (recently_added.length === 0) {
    return (
      <>
        {header}
        <EmptyState icon={Disc3} title={t.home.emptyTitle}>
          {t.home.emptyText}
        </EmptyState>
      </>
    );
  }
  return (
    <>
      {header}
      <RefreshFailed query={home} />
      <Shelf title={t.home.recentlyAdded} more="/albums" wide>
        {recently_added.slice(0, 6).map((album) => (
          <NewAlbum key={album.id} album={album} />
        ))}
      </Shelf>
      <Albums title={t.home.forYou} albums={for_you} />
      <Albums title={t.home.recentlyPlayed} albums={recently_played} />
      <Albums title={t.home.newReleases} albums={new_releases} more="/albums?sort=year" />
      {genres.data && genres.data.length > 0 && (
        <div className={styles.section}>
          <h2 className={styles.heading}>{t.home.genres}</h2>
          <GenreLinks
            label={t.home.genres}
            genres={genres.data.slice(0, GENRES).map((genre) => genre.name)}
            to={(genre) => `/albums?genre=${encodeURIComponent(genre ?? "")}`}
          />
        </div>
      )}
    </>
  );
}

function Albums({ title, albums, more }: { title: string; albums: Album[]; more?: string }) {
  if (albums.length === 0) return null;
  return (
    <Shelf title={title} more={more}>
      {albums.map((album) => (
        <AlbumCard key={album.id} album={album} />
      ))}
    </Shelf>
  );
}
