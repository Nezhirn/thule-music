import { useQuery } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { errorMessage } from "../api/errors";
import { artistNames } from "../catalog/format";
import { LoadError } from "../catalog/LoadError";
import type { Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { lyricsQuery, type Lyrics } from "../lyrics/queries";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Switch } from "../ui/Switch";
import { TextArea } from "../ui/TextField";
import { useFindLyricsAgain, useSaveLyrics } from "./queries";
import styles from "./edits.module.css";

/** Where an admin writes a track's lyrics, takes wrong ones away, or has them looked for
 * again. */
export function LyricsDialog({ track, onClose }: { track: Track | null; onClose(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={track !== null}
      onClose={onClose}
      title={t.edits.lyrics.title}
      description={track && `${track.title} — ${artistNames(track)}`}
      wide
    >
      {track && <LyricsEditor key={track.id} track={track} onClose={onClose} />}
    </Dialog>
  );
}

function LyricsEditor({ track, onClose }: { track: Track; onClose(): void }) {
  const { t } = useI18n();
  // What the server has now, not a copy loaded minutes ago.
  const lyrics = useQuery({ ...lyricsQuery(track.id), staleTime: 0 });
  if (lyrics.isPending) {
    return (
      <p role="status" className={styles.hint}>
        {t.common.loading}
      </p>
    );
  }
  if (lyrics.isError) {
    return <LoadError error={lyrics.error} onRetry={() => void lyrics.refetch()} />;
  }
  return <LyricsForm track={track} lyrics={lyrics.data} onClose={onClose} />;
}

/** The words to edit: the plain text, or the timed lines without their times. */
function wordsOf(lyrics: Lyrics | null): string {
  if (!lyrics) return "";
  return lyrics.plain ?? lyrics.lines.map((line) => line.text).join("\n");
}

function LyricsForm({
  track,
  lyrics,
  onClose,
}: {
  track: Track;
  lyrics: Lyrics | null;
  onClose(): void;
}) {
  const { t } = useI18n();
  const text = t.edits.lyrics;
  const hintId = useId();
  const againId = useId();
  const [words, setWords] = useState(() => wordsOf(lyrics));
  const [instrumental, setInstrumental] = useState(lyrics?.instrumental ?? false);
  const save = useSaveLyrics(track);
  const again = useFindLyricsAgain(track);
  const busy = save.isPending || again.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate({ text: words, instrumental }, { onSuccess: onClose });
  }

  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <TextArea
        label={text.words}
        rows={14}
        value={words}
        maxLength={100_000}
        disabled={instrumental}
        aria-describedby={hintId}
        onChange={(event) => setWords(event.target.value)}
      />
      <p id={hintId} className={styles.hint}>
        {text.hint}
      </p>
      <Switch
        label={text.instrumental}
        description={text.instrumentalNote}
        checked={instrumental}
        onChange={setInstrumental}
      />
      {save.error && <Alert tone="error">{errorMessage(t, save.error)}</Alert>}
      <div className={styles.buttons}>
        <Button
          variant="secondary"
          aria-describedby={againId}
          title={text.findAgainNote}
          disabled={busy}
          busyLabel={again.isPending && text.finding}
          onClick={() => again.mutate(undefined, { onSuccess: onClose })}
        >
          {text.findAgain}
        </Button>
        <span id={againId} className="visually-hidden">
          {text.findAgainNote}
        </span>
        <span className={styles.spacer} />
        <Button variant="secondary" onClick={onClose}>
          {t.edits.cancel}
        </Button>
        <Button type="submit" disabled={busy} busyLabel={save.isPending && text.saving}>
          {text.save}
        </Button>
      </div>
    </form>
  );
}
