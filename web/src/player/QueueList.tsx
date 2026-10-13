import { X } from "lucide-react";
import { useRef, type MouseEvent } from "react";
import { Cover } from "../catalog/Cover";
import { artistNames } from "../catalog/format";
import { useI18n } from "../i18n";
import { IconButton } from "../ui/IconButton";
import { usePlayer, usePlayerControls } from "./context";
import { upcoming, type QueueItem } from "./queue";
import styles from "./QueueList.module.css";

// Items listed; the rest are counted. A queue of a whole library would be a long page.
const LIMIT = 100;

/** What plays next: each item plays on a click, and can be taken out. */
export function QueueList({ labelledBy }: { labelledBy: string }) {
  const { t } = useI18n();
  const queue = usePlayer((state) => state.queue);
  const list = useRef<HTMLOListElement>(null);
  const next = upcoming(queue);
  if (next.length === 0) return <p className={styles.note}>{t.player.queueEmpty}</p>;

  // Focus goes to the next row's button (or the previous one's), not back to the page.
  const removeFrom = (event: MouseEvent<HTMLElement>) => {
    const row = event.currentTarget.closest("li");
    const neighbour = row?.nextElementSibling ?? row?.previousElementSibling;
    requestAnimationFrame(() => {
      const target = neighbour?.querySelector<HTMLElement>("[data-remove]");
      (target ?? list.current?.closest("section, aside, dialog")?.querySelector("h2"))?.focus();
    });
  };

  return (
    <>
      <ol ref={list} className={styles.list} aria-labelledby={labelledBy}>
        {next.slice(0, LIMIT).map((item) => (
          <Row key={item.key} item={item} onRemove={removeFrom} />
        ))}
      </ol>
      {next.length > LIMIT && (
        <p className={styles.note}>{t.player.moreQueued(next.length - LIMIT)}</p>
      )}
    </>
  );
}

function Row({
  item,
  onRemove,
}: {
  item: QueueItem;
  onRemove(event: MouseEvent<HTMLElement>): void;
}) {
  const { t } = useI18n();
  const player = usePlayerControls();
  const { track } = item;
  const artists = artistNames(track);
  return (
    <li className={styles.row}>
      <button
        type="button"
        className={styles.jump}
        aria-label={`${track.title}, ${artists}`}
        onClick={() => player.jump(item.key)}
      >
        <Cover id={track.album.cover_id} sizes="40px" className={styles.cover} />
        <span className={styles.titles}>
          <span className={styles.title}>{track.title}</span>
          <span className={styles.artist}>{artists}</span>
        </span>
      </button>
      <IconButton
        icon={X}
        size="sm"
        label={t.player.removeFromQueue(track.title)}
        data-remove
        className={styles.remove}
        onClick={(event) => {
          onRemove(event);
          player.remove(item.key);
        }}
      />
    </li>
  );
}
