import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { announce } from "../ui/toast";
import { foundText } from "./format";
import {
  BUSY_POLL_MS,
  libraryChanged,
  pendingOf,
  scanQuery,
  summaryQuery,
  type Scan,
} from "./queries";

/** The scan is waiting or running, or the imports it queued are. */
const scanBusy = (scan: Scan | null | undefined) =>
  scan?.status === "queued" || scan?.status === "running" || pendingOf(scan?.imports) > 0;

/** The latest scan and the background work, looked at every second while the server is
 * busy. Once a scan watched here is over, the library and what shows it are reloaded, and
 * what it found is said. */
export function useLibraryWork() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const scan = useQuery({
    ...scanQuery,
    refetchInterval: (query) => (scanBusy(query.state.data) ? BUSY_POLL_MS : false),
  });
  const latest = scan.data;
  const scanning = latest?.status === "queued" || latest?.status === "running";
  const importing = scanBusy(latest);
  const summary = useQuery({
    ...summaryQuery,
    refetchInterval: (query) =>
      importing || (query.state.data?.pending ?? 0) > 0 ? BUSY_POLL_MS : false,
  });
  const busy = importing || (summary.data?.pending ?? 0) > 0;

  // The scan seen at work here; told about once it is over.
  const watched = useRef<string | null>(null);
  useEffect(() => {
    if (!latest) return;
    if (scanBusy(latest)) {
      watched.current = latest.id;
      return;
    }
    if (watched.current !== latest.id) return;
    watched.current = null;
    libraryChanged(queryClient);
    if (latest.status === "done" && latest.result) {
      announce(t.admin.scan.done(foundText(t, latest.result)));
    }
  }, [latest, queryClient, t]);

  // Numbers and errors once all the work is done.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) void queryClient.invalidateQueries({ queryKey: ["admin"] });
    wasBusy.current = busy;
  }, [busy, queryClient]);

  // New errors (or fewer, retried elsewhere): the list of them is out of date.
  const failed = summary.data?.failed;
  const seenFailed = useRef(failed);
  useEffect(() => {
    if (seenFailed.current !== undefined && failed !== seenFailed.current) {
      void queryClient.invalidateQueries({ queryKey: ["admin", "jobs", "failed"] });
    }
    seenFailed.current = failed;
  }, [failed, queryClient]);

  const counts = latest?.imports;
  const total = counts ? counts.queued + counts.running + counts.done + counts.failed : 0;
  return {
    scan,
    summary,
    /** The latest scan is waiting or running. */
    scanning,
    /** The latest scan, or the imports it queued, are not done. */
    scanBusy: importing,
    /** Files of the latest scan imported so far, of all it queued; null if it queued none. */
    imports: counts && total > 0 ? { done: counts.done + counts.failed, total } : null,
  };
}
