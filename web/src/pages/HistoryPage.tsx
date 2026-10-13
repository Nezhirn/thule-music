import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";
import { api } from "../api/client";
import { errorMessage, unwrap } from "../api/errors";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { PageLoading } from "../catalog/PageStatus";
import { homeQuery } from "../catalog/queries";
import { TrackTable } from "../catalog/TrackTable";
import { dayHeading } from "../history/days";
import { historyQuery } from "../history/queries";
import { useI18n } from "../i18n";
import type { Source } from "../player/player";
import { Button } from "../ui/Button";
import { Dialog, DialogButtons } from "../ui/Dialog";
import { EmptyState } from "../ui/EmptyState";
import { PageHeader } from "../ui/PageHeader";
import { announce } from "../ui/toast";
import styles from "./CatalogPage.module.css";

const SOURCE: Source = { type: "history", id: "history" };

/** Every play, newest first, under the day it was on. A row plays the history shown. */
export function HistoryPage() {
  const { t, language } = useI18n();
  const history = useInfiniteQuery(historyQuery);
  const [clearing, setClearing] = useState(false);
  const plays = history.data?.pages.flatMap((page) => page.items) ?? [];
  const now = new Date();
  return (
    <>
      <PageHeader title={t.nav.history} />
      {plays.length > 0 && (
        <div className={styles.toolbar}>
          <Button variant="secondary" size="small" onClick={() => setClearing(true)}>
            {t.history.clear}
          </Button>
        </div>
      )}
      {history.isPending && <PageLoading />}
      {history.isError && (
        <LoadError error={history.error} onRetry={() => void history.refetch()} />
      )}
      {history.isSuccess && plays.length === 0 && (
        <EmptyState icon={History} title={t.history.empty}>
          {t.history.emptyText}
        </EmptyState>
      )}
      {plays.length > 0 && (
        <TrackTable
          tracks={plays.map((play) => play.track)}
          keys={plays.map((play) => play.id)}
          label={t.nav.history}
          source={SOURCE}
          withAlbum
          groupBy={(_, index) => dayHeading(new Date(plays[index]!.played_at), now, language, t)}
        />
      )}
      <LoadMore query={history} />
      <ClearDialog open={clearing} onClose={() => setClearing(false)} />
    </>
  );
}

function ClearDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const clear = async () => {
    setBusy(true);
    try {
      await unwrap(api.DELETE("/api/v1/me/history"));
      queryClient.setQueryData(historyQuery.queryKey, {
        pages: [{ items: [], next: null }],
        pageParams: [null],
      });
      // "Recently played", "For you".
      void queryClient.invalidateQueries({ queryKey: homeQuery.queryKey });
      announce(t.history.cleared);
    } catch (error) {
      announce(t.history.failed(errorMessage(t, error)));
    }
    setBusy(false);
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t.history.clearTitle}
      description={t.history.clearText}
    >
      <DialogButtons>
        <Button variant="secondary" onClick={onClose}>
          {t.playlists.cancel}
        </Button>
        <Button busyLabel={busy && t.history.clearing} onClick={() => void clear()}>
          {t.history.clearConfirm}
        </Button>
      </DialogButtons>
    </Dialog>
  );
}
