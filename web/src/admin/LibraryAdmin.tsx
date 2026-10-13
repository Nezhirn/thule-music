import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { errorMessage, unwrap } from "../api/errors";
import { LoadError } from "../catalog/LoadError";
import { LoadMore } from "../catalog/LoadMore";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { IconButton } from "../ui/IconButton";
import { announce } from "../ui/toast";
import { ago, count, fileSize, foundText, hoursOfMusic } from "./format";
import {
  failedJobsQuery,
  pendingOf,
  scanQuery,
  statsQuery,
  summaryQuery,
  type Job,
  type Scan,
} from "./queries";
import { useLibraryWork } from "./work";
import styles from "./admin.module.css";

// A scan waiting this long has no worker to run it, most likely.
const STUCK_AFTER_MS = 10_000;

/** The library's numbers, scanning, and the background work with its errors. */
export function LibraryAdmin() {
  const work = useLibraryWork();
  return (
    <div className={styles.cards}>
      <Stats />
      <ScanCard work={work} />
      <JobsCard work={work} />
    </div>
  );
}

function Stats() {
  const { t, language } = useI18n();
  const stats = useQuery(statsQuery);
  const text = t.admin.stats;
  return (
    <Card title={text.title}>
      {stats.isError ? (
        <LoadError error={stats.error} onRetry={() => void stats.refetch()} />
      ) : (
        <dl className={styles.stats} aria-busy={stats.isPending}>
          {(
            [
              [
                stats.data && count(language, stats.data.tracks),
                text.tracks(stats.data?.tracks ?? 0),
              ],
              [
                stats.data && count(language, stats.data.albums),
                text.albums(stats.data?.albums ?? 0),
              ],
              [
                stats.data && count(language, stats.data.artists),
                text.artists(stats.data?.artists ?? 0),
              ],
              [stats.data && hoursOfMusic(language, stats.data.duration_ms), text.duration],
              [stats.data && fileSize(language, stats.data.size_bytes), text.size],
            ] as const
          ).map(([value, label]) => (
            <div key={label} className={styles.stat}>
              <dt className={styles.statLabel}>{label}</dt>
              <dd className={styles.statValue}>{value ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

type Work = ReturnType<typeof useLibraryWork>;

function ScanCard({ work }: { work: Work }) {
  const { t, language } = useI18n();
  const text = t.admin.scan;
  const queryClient = useQueryClient();
  const scan = work.scan.data;
  const start = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/library/scan")),
    onSuccess: (started) => {
      queryClient.setQueryData(scanQuery.queryKey, started);
      void queryClient.invalidateQueries({ queryKey: summaryQuery.queryKey });
    },
    onError: (error) => announce(errorMessage(t, error)),
  });
  const stuck = useStuck(scan);

  let status: string | null = null;
  if (scan === null) status = text.never;
  else if (scan?.status === "queued") status = stuck ? text.stuck : text.queued;
  else if (scan?.status === "running") status = text.running;
  else if (work.scanBusy) status = text.importing;

  return (
    <Card title={text.title}>
      <p className={styles.note}>{text.about}</p>
      {work.scan.isError && (
        <LoadError error={work.scan.error} onRetry={() => void work.scan.refetch()} />
      )}
      {scan?.status === "failed" && (
        <Alert tone="error">
          {text.failed} {scan.error}
        </Alert>
      )}
      <div className={styles.scanState}>
        <p role="status" className={styles.scanText}>
          {status}
        </p>
        {status === text.importing && work.imports ? (
          <div className={styles.progressRow}>
            <progress
              className={styles.progress}
              aria-label={text.progress}
              value={work.imports.done}
              max={work.imports.total}
            />
            <span className={styles.progressText} aria-hidden>
              {text.of(work.imports.done, work.imports.total)}
            </span>
          </div>
        ) : (
          work.scanning && <progress className={styles.progress} aria-label={text.title} />
        )}
        {!work.scanBusy && scan?.status === "done" && (
          <div className={styles.lastScan}>
            <p>{text.last(ago(language, new Date(scan.finished_at ?? scan.created_at)))}</p>
            {scan.result && (
              <p className={styles.note}>
                {foundText(t, scan.result)} · {text.files(scan.result.files)}
              </p>
            )}
          </div>
        )}
      </div>
      <Button
        className={styles.start}
        busyLabel={(start.isPending || work.scanBusy) && text.scanning}
        onClick={() => start.mutate()}
      >
        {text.start}
      </Button>
    </Card>
  );
}

/** Whether `scan` has been waiting for a worker for long. */
function useStuck(scan: Scan | null | undefined): boolean {
  const waitingSince = scan?.status === "queued" ? scan.created_at : null;
  const [stuckSince, setStuckSince] = useState<string | null>(null);
  useEffect(() => {
    if (!waitingSince) return;
    const left = new Date(waitingSince).getTime() + STUCK_AFTER_MS - Date.now();
    const timer = setTimeout(() => setStuckSince(waitingSince), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [waitingSince]);
  return waitingSince !== null && stuckSince === waitingSince;
}

function JobsCard({ work }: { work: Work }) {
  const { t } = useI18n();
  const text = t.admin.jobs;
  const kinds = Object.entries(work.summary.data?.kinds ?? {}).filter(
    ([, counts]) => pendingOf(counts) > 0,
  );
  return (
    <Card title={text.title}>
      {work.summary.isError ? (
        <LoadError error={work.summary.error} onRetry={() => void work.summary.refetch()} />
      ) : kinds.length ? (
        <div className={styles.group}>
          <h3 className={styles.subheading}>{text.pending}</h3>
          <ul className={styles.pending}>
            {kinds.map(([kind, counts]) => (
              <li key={kind} className={styles.pendingItem}>
                <span>{text.kinds[kind] ?? kind}</span>
                <span className={styles.pendingCount}>{pendingOf(counts)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        work.summary.data && <p className={styles.note}>{text.idle}</p>
      )}
      <FailedJobs />
    </Card>
  );
}

function FailedJobs() {
  const { t } = useI18n();
  const text = t.admin.jobs;
  const queryClient = useQueryClient();
  const jobs = useInfiniteQuery(failedJobsQuery);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });
  const retryAll = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/library/jobs/retry")),
    onSuccess: ({ retried }) => announce(text.retried(retried)),
    onError: (error) => announce(errorMessage(t, error)),
    onSettled: refresh,
  });
  const clear = useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/v1/library/jobs/failed")),
    onSuccess: () => announce(text.cleared),
    onError: (error) => announce(errorMessage(t, error)),
    onSettled: refresh,
  });

  if (jobs.isPending) return null;
  if (jobs.isError) return <LoadError error={jobs.error} onRetry={() => void jobs.refetch()} />;
  const total = jobs.data.pages[0]?.total ?? 0;
  if (total === 0) return <p className={styles.note}>{text.noFailures}</p>;
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h3 className={styles.subheading}>{text.failed(total)}</h3>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="small"
            disabled={retryAll.isPending || clear.isPending}
            onClick={() => retryAll.mutate()}
          >
            {text.retryAll}
          </Button>
          <Button
            variant="secondary"
            size="small"
            disabled={retryAll.isPending || clear.isPending}
            onClick={() => clear.mutate()}
          >
            {text.clear}
          </Button>
        </div>
      </div>
      <ul className={styles.jobs}>
        {jobs.data.pages.flatMap((page) =>
          page.items.map((job) => <FailedJob key={job.id} job={job} onDone={refresh} />),
        )}
      </ul>
      <LoadMore query={jobs} />
    </div>
  );
}

function FailedJob({ job, onDone }: { job: Job; onDone(): void }) {
  const { t, language } = useI18n();
  const text = t.admin.jobs;
  const kind = text.kinds[job.kind] ?? job.kind;
  const retry = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/library/jobs/{job_id}/retry", { params: { path: { job_id: job.id } } }),
      ),
    onSuccess: () => announce(text.retried(1)),
    onError: (error) => announce(errorMessage(t, error)),
    onSettled: onDone,
  });
  return (
    <li className={styles.job}>
      <div className={styles.jobText}>
        <p className={styles.jobTitle}>
          <span className={styles.kind}>{kind}</span>
          {job.subject && <span className={styles.subject}>{job.subject}</span>}
        </p>
        {job.error && <p className={styles.jobError}>{job.error}</p>}
        <p className={styles.jobMeta}>
          {ago(language, new Date(job.finished_at ?? job.created_at))}
        </p>
      </div>
      <IconButton
        icon={RotateCcw}
        label={text.retry(job.subject ?? kind)}
        disabled={retry.isPending}
        onClick={() => retry.mutate()}
      />
    </li>
  );
}
