import { useI18n } from "../i18n";
import { Logo } from "./Logo";
import styles from "./Splash.module.css";

/** Shown while the stored session is checked with the server. */
export function Splash() {
  const { t } = useI18n();
  return (
    <div className={styles.splash} role="status" aria-busy="true">
      <div className={styles.logo}>
        <Logo />
      </div>
      <span className="visually-hidden">{t.common.loading}</span>
    </div>
  );
}
