import { useEffect, useRef, type CSSProperties } from "react";
import styles from "./Slider.module.css";

interface Props {
  /** The accessible name. */
  label: string;
  value: number;
  max: number;
  step?: number;
  /** How screen readers say the value ("1:05 of 3:20", "70%"). */
  valueText: string;
  disabled?: boolean;
  /** While the thumb moves. */
  onInput(value: number): void;
  /** When it is let go, or moved with a key. */
  onCommit?(value: number): void;
  className?: string;
}

/** A horizontal slider (a native range input) with the part up to the value filled. */
export function Slider({
  label,
  value,
  max,
  step = 1,
  valueText,
  disabled,
  onInput,
  onCommit,
  className,
}: Props) {
  const input = useRef<HTMLInputElement>(null);
  // Moved since the last commit.
  const moved = useRef(false);

  // React's onChange fires while dragging; the native change event, once let go. A drag
  // that ends without one (cancelled by a scroll on a phone, let go outside the window)
  // commits where it got to: the value doesn't stay held.
  useEffect(() => {
    const element = input.current;
    if (!element || !onCommit) return;
    const commit = () => {
      moved.current = false;
      onCommit(Number(element.value));
    };
    const settle = () => {
      if (moved.current) commit();
    };
    // After the change event a release brings, if it does.
    const released = () => setTimeout(settle);
    const pressed = () => {
      window.addEventListener("pointerup", released, { once: true });
      window.addEventListener("pointercancel", released, { once: true });
    };
    element.addEventListener("change", commit);
    element.addEventListener("pointerdown", pressed);
    element.addEventListener("blur", settle);
    return () => {
      element.removeEventListener("change", commit);
      element.removeEventListener("pointerdown", pressed);
      element.removeEventListener("blur", settle);
      window.removeEventListener("pointerup", released);
      window.removeEventListener("pointercancel", released);
    };
  }, [onCommit]);

  const fill = max > 0 ? Math.min(Math.max(value / max, 0), 1) * 100 : 0;
  return (
    <input
      ref={input}
      type="range"
      className={[styles.slider, className].filter(Boolean).join(" ")}
      style={{ "--fill": `${fill}%` } as CSSProperties}
      aria-label={label}
      aria-valuetext={valueText}
      min={0}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        moved.current = true;
        onInput(Number(event.target.value));
      }}
    />
  );
}
