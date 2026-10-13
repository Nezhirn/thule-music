import type { ReactNode } from "react";
import { useChooseLanguage } from "../auth/useChooseLanguage";
import styles from "./CenteredLayout.module.css";
import { LanguageSwitch } from "./LanguageSwitch";
import { Logo } from "./Logo";

/** A glass card over a coloured backdrop: sign-in, first run, and status screens. */
export function CenteredLayout({ children }: { children: ReactNode }) {
  const chooseLanguage = useChooseLanguage();
  return (
    <div className={styles.page}>
      <div className={styles.backdrop} aria-hidden="true" />
      <header className={styles.top}>
        <Logo />
        <LanguageSwitch onChange={chooseLanguage} />
      </header>
      <main className={styles.main}>
        <div className={styles.card}>{children}</div>
      </main>
    </div>
  );
}
