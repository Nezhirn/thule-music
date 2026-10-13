import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import styles from "./EmptyState.module.css";

/** In place of content that isn't there (yet): an icon, a short title, a hint. */
export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.icon}>
        <Icon />
      </span>
      <p className={styles.title}>{title}</p>
      {children && <p className={styles.text}>{children}</p>}
    </div>
  );
}
