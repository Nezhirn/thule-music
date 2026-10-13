import type { ReactNode } from "react";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import styles from "./PageHeader.module.css";

interface Props {
  title: string;
  /** For the browser tab, if not the title. */
  documentTitle?: string;
  /** Buttons beside the title. */
  actions?: ReactNode;
  children?: ReactNode;
}

/** The page's heading (its only h1) and the title of the browser tab. */
export function PageHeader({ title, documentTitle = title, actions, children }: Props) {
  useDocumentTitle(documentTitle);
  const heading = <h1 className={styles.title}>{title}</h1>;
  return (
    <header className={styles.header}>
      {actions ? (
        <div className={styles.line}>
          {heading}
          {actions}
        </div>
      ) : (
        heading
      )}
      {children && <p className={styles.subtitle}>{children}</p>}
    </header>
  );
}
