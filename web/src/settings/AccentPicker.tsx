import { Check } from "lucide-react";
import { useEffect, useId, useRef, type CSSProperties } from "react";
import { useI18n } from "../i18n";
import { ACCENT_PRESETS, DEFAULT_ACCENT } from "../theme/theme";
import { Button } from "../ui/Button";
import { usePicked } from "../ui/usePicked";
import styles from "./AccentPicker.module.css";

interface Props {
  labelledBy: string;
  /** The saved accent; null is the default. */
  value: string | null;
  /** A colour being picked in the colour dialog, shown before it is chosen. */
  onPreview(color: string): void;
  onPick(color: string | null): void;
}

/** The presets as radio buttons, any other colour through the system colour dialog. */
export function AccentPicker({ labelledBy, value, onPreview, onPick }: Props) {
  const { t } = useI18n();
  const names = t.settings.appearance.accents;
  const group = useId();
  const custom = useRef<HTMLInputElement>(null);
  const [shown, show] = usePicked((value ?? DEFAULT_ACCENT).toLowerCase());
  const current = shown;
  const preset = ACCENT_PRESETS.find(({ color }) => color === current);

  // `input` events (React's onChange) follow the dialog live; `change` fires once the user
  // settles on a colour, which is when it is saved.
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
  useEffect(() => {
    const input = custom.current;
    const onChange = () => input && pick.current(input.value);
    input?.addEventListener("change", onChange);
    return () => input?.removeEventListener("change", onChange);
  }, []);

  return (
    <div className={styles.picker}>
      <div role="radiogroup" aria-labelledby={labelledBy} className={styles.swatches}>
        {ACCENT_PRESETS.map(({ id, color }) => (
          <label
            key={id}
            className={styles.swatch}
            style={{ "--swatch": color } as CSSProperties}
            title={names[id]}
          >
            <input
              type="radio"
              name={group}
              aria-label={names[id]}
              checked={preset?.id === id}
              onChange={() => {
                show(color);
                onPick(color);
              }}
              className={styles.input}
            />
            <Check className={styles.check} />
          </label>
        ))}
      </div>
      <label
        className={`${styles.swatch} ${preset ? styles.rainbow : styles.chosen}`}
        style={{ "--swatch": current } as CSSProperties}
        title={t.settings.appearance.custom}
      >
        <input
          ref={custom}
          type="color"
          aria-label={t.settings.appearance.custom}
          value={current}
          onChange={(event) => onPreview(event.target.value)}
          className={styles.input}
        />
        {!preset && <Check className={styles.check} />}
      </label>
      <Button
        variant="secondary"
        size="small"
        disabled={value === null}
        onClick={() => onPick(null)}
      >
        {t.settings.appearance.reset}
      </Button>
    </div>
  );
}
