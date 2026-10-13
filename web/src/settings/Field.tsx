import type { ReactNode } from "react";
import styles from "./Settings.module.css";

/** A setting with a control other than a switch: its name and note above the control. */
export function Field({
  id,
  title,
  note,
  children,
}: {
  /** Id of the name, for the control's aria-labelledby. */
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <div className={styles.fieldText}>
        <span id={id} className={styles.fieldTitle}>
          {title}
        </span>
        {note && <p className={styles.note}>{note}</p>}
      </div>
      {children}
    </div>
  );
}
