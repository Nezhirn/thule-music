import { Pause, Play } from "lucide-react";
import { useState } from "react";
import type { Track } from "../catalog/queries";
import { useI18n } from "../i18n";
import { IconButton } from "../ui/IconButton";
import { usePlayer, usePlayerControls } from "./context";
import type { Source } from "./player";
import styles from "./PlayButton.module.css";

interface Props {
  source: Source;
  /** What it plays, for the button's name: "Play Northern Lights". */
  name: string;
  /** The tracks; loaded on the click where the page doesn't have them (a card). */
  tracks(): Track[] | Promise<Track[]>;
  size?: "md" | "lg";
  className?: string;
}

/** Plays an album's or artist's tracks; pauses and resumes them once they play. */
export function PlayButton({ source, name, tracks, size = "lg", className }: Props) {
  const { t } = useI18n();
  const player = usePlayerControls();
  const current = usePlayer(
    (state) => state.source?.type === source.type && state.source.id === source.id,
  );
  const playing = usePlayer((state) => state.playing) && current;
  const [loading, setLoading] = useState(false);

  const onClick = async () => {
    if (current) {
      player.toggle();
      return;
    }
    setLoading(true);
    try {
      player.play(await tracks(), { source });
    } catch {
      // The album couldn't be loaded: there is nothing to play.
    } finally {
      setLoading(false);
    }
  };

  return (
    <IconButton
      icon={playing ? Pause : Play}
      label={playing ? t.player.pause : t.player.playItem(name)}
      size={size}
      primary
      aria-busy={loading || undefined}
      data-playing={playing || undefined}
      className={[styles.play, className].filter(Boolean).join(" ")}
      onClick={() => void onClick()}
    />
  );
}
