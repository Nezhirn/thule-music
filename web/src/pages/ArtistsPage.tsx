import { useInfiniteQuery } from "@tanstack/react-query";
import { MicVocal } from "lucide-react";
import { ArtistCard } from "../catalog/ArtistCard";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading } from "../catalog/PageStatus";
import { artistsQuery } from "../catalog/queries";
import { useI18n } from "../i18n";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import grid from "../catalog/Grid.module.css";

export function ArtistsPage() {
  const { t } = useI18n();
  const artists = useInfiniteQuery(artistsQuery);
  const total = artists.data?.pages[0]?.total;
  return (
    <>
      <PageHeader title={t.nav.artists} />
      {artists.isPending && <PageLoading />}
      {artists.isError && (
        <LoadError error={artists.error} onRetry={() => void artists.refetch()} />
      )}
      {total === 0 && <EmptyState icon={MicVocal} title={t.catalog.noArtists} />}
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
