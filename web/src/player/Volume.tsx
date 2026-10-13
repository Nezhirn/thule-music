import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useI18n } from "../i18n";
import { IconButton } from "../ui/IconButton";
import { Slider } from "../ui/Slider";
import { usePlayer, usePlayerControls } from "./context";
import styles from "./Volume.module.css";

export function Volume() {
  const { t } = useI18n();
  const player = usePlayerControls();
  const muted = usePlayer((state) => state.muted);
  const volume = usePlayer((state) => state.volume);
  const percent = Math.round((muted ? 0 : volume) * 100);
  const icon = percent === 0 ? VolumeX : percent < 50 ? Volume1 : Volume2;
  return (
    <div className={styles.volume}>
      <IconButton
        icon={icon}
        label={muted ? t.player.unmute : t.player.mute}
        size="sm"
        onClick={() => player.setMuted(!muted)}
      />
      <Slider
        label={t.player.volume}
        value={percent}
        max={100}
        valueText={`${percent}%`}
        onInput={(value) => player.setVolume(value / 100)}
        className={styles.slider}
      />
    </div>
  );
}
