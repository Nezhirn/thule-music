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

  // React's onChange fires while dragging; the native change event, once let go.
  useEffect(() => {
    const element = input.current;
    if (!element || !onCommit) return;
    const commit = () => onCommit(Number(element.value));
    element.addEventListener("change", commit);
    return () => element.removeEventListener("change", commit);
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
      onChange={(event) => onInput(Number(event.target.value))}
    />
  );
}
