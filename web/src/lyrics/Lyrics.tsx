import { useQuery } from "@tanstack/react-query";
import { MessageSquareOff, Music } from "lucide-react";
import type { Track } from "../catalog/queries";
import { LoadError } from "../catalog/LoadError";
import { useI18n } from "../i18n";
import { EmptyState } from "../ui/EmptyState";
import { lyricsQuery, stanzas } from "./queries";
import styles from "./Lyrics.module.css";

/** A track's lyrics as text to read, stanza by stanza, and where they come from; or why
 * there are none. `size`: large on its page, smaller in the phone's player. */
export function Lyrics({ track, size = "large" }: { track: Track; size?: "large" | "small" }) {
  const { t } = useI18n();
  const lyrics = useQuery(lyricsQuery(track.id));
  if (lyrics.isPending) {
    return (
      <p role="status" className={styles.loading}>
        {t.common.loading}
      </p>
    );
  }
  if (lyrics.isError) {
    return <LoadError error={lyrics.error} onRetry={() => void lyrics.refetch()} />;
  }
  if (lyrics.data?.instrumental) {
    return (
      <EmptyState icon={Music} title={t.lyrics.instrumental}>
        {t.lyrics.instrumentalText}
      </EmptyState>
    );
  }
  const text = lyrics.data ? stanzas(lyrics.data) : [];
  if (!lyrics.data || text.length === 0) {
    return (
      <EmptyState icon={MessageSquareOff} title={t.lyrics.none}>
        {t.lyrics.noneText}
      </EmptyState>
    );
  }
  const source = t.lyrics.source[lyrics.data.source];
  return (
    <div className={`${styles.lyrics} ${styles[size]}`}>
      {text.map((stanza, i) => (
        <p key={i} className={styles.stanza}>
          {stanza.map((line, j) => (
            <span key={j} className={styles.line}>
              {line}
            </span>
          ))}
        </p>
      ))}
      {source && <p className={styles.source}>{source}</p>}
    </div>
  );
}
