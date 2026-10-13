import type { ReactNode } from "react";
import styles from "./Alert.module.css";

/** A message about the whole form or page; errors are announced to screen readers. */
export function Alert({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`${styles.alert} ${styles[tone]}`}>
      {children}
    </div>
  );
}
