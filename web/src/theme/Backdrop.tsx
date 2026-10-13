import type { CSSProperties } from "react";
import styles from "./Backdrop.module.css";
import { useTheme } from "./context";

/** Soft colour fields behind the glass: the cover's colours, or shades of the accent. */
export function Backdrop() {
  const { ambient, blur } = useTheme();
  const style = {
    "--ambient-1": ambient[0],
    "--ambient-2": ambient[1],
    "--ambient-3": ambient[2],
  } as CSSProperties;
  return (
    <div
      className={`${styles.backdrop} ${blur ? styles.soft : ""}`}
      style={style}
      data-testid="backdrop"
      aria-hidden="true"
    />
  );
}
