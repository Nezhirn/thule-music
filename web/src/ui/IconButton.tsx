import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, Ref } from "react";
import styles from "./IconButton.module.css";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The accessible name, also shown as a tooltip. */
  label: string;
  icon: LucideIcon;
  size?: "sm" | "md" | "lg";
  /** Filled with the accent: the main action of a group (play). */
  primary?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label,
  icon: Icon,
  size = "md",
  primary,
  className,
  ...button
}: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...button}
      className={[styles.button, styles[size], primary && styles.primary, className]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon className={styles.icon} />
    </button>
  );
}
