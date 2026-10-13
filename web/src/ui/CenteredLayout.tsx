import type { ReactNode } from "react";
import { useChooseLanguage } from "../auth/useChooseLanguage";
import { Backdrop } from "../theme/Backdrop";
import styles from "./CenteredLayout.module.css";
import { LanguageSwitch } from "./LanguageSwitch";
import { Logo } from "./Logo";

/** A glass card over a coloured backdrop: sign-in, first run, and status screens. */
export function CenteredLayout({ children }: { children: ReactNode }) {
  const { choose } = useChooseLanguage();
  return (
    <div className={styles.page}>
      <Backdrop />
      <header className={styles.top}>
        <Logo />
        <LanguageSwitch onChange={choose} />
      </header>
      <main className={styles.main}>
        <div className={`glass ${styles.card}`}>{children}</div>
      </main>
    </div>
  );
}
