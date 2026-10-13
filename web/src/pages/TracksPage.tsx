import { useInfiniteQuery } from "@tanstack/react-query";
import { Music } from "lucide-react";
import { useSearchParams } from "react-router";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading } from "../catalog/PageStatus";
import { pick, TRACK_SORTS, tracksQuery } from "../catalog/queries";
import { SortSelect } from "../catalog/SortSelect";
import { TrackTable } from "../catalog/TrackTable";
import { useI18n } from "../i18n";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import styles from "./CatalogPage.module.css";

export function TracksPage() {
  const { t } = useI18n();
  const [params, setParams] = useSearchParams();
  const sort = pick(params.get("sort"), TRACK_SORTS) ?? "added";
  const tracks = useInfiniteQuery(tracksQuery(sort));
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
            setParams(value === "added" ? {} : { sort: value }, { replace: true })
          }
        />
      </div>
      {tracks.isPending && <PageLoading />}
      {tracks.isError && <LoadError error={tracks.error} onRetry={() => void tracks.refetch()} />}
      {total === 0 && <EmptyState icon={Music} title={t.catalog.noTracks} />}
      {tracks.data && total !== 0 && (
        <TrackTable
          tracks={tracks.data.pages.flatMap((page) => page.items)}
          label={t.nav.tracks}
          withAlbum
        />
      )}
      <LoadMore query={tracks} />
    </>
  );
}
