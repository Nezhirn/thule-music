import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  /** Disables the button and shows this text while an action runs. */
  busyLabel?: string | false;
}

export function Button({ variant = "primary", busyLabel, children, className, ...button }: Props) {
  return (
    <button
      type="button"
      {...button}
      disabled={button.disabled || Boolean(busyLabel)}
      aria-busy={busyLabel ? true : undefined}
      className={[styles.button, styles[variant], className].filter(Boolean).join(" ")}
    >
      {busyLabel || children}
    </button>
  );
}
