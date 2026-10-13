import type { ReactNode } from "react";
import { useDocumentTitle } from "../lib/useDocumentTitle";
import styles from "./PageHeader.module.css";

interface Props {
  title: string;
  /** For the browser tab, if not the title. */
  documentTitle?: string;
  children?: ReactNode;
}

/** The page's heading (its only h1) and the title of the browser tab. */
export function PageHeader({ title, documentTitle = title, children }: Props) {
  useDocumentTitle(documentTitle);
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      {children && <p className={styles.subtitle}>{children}</p>}
    </header>
  );
}
