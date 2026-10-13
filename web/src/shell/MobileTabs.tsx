import { NavLink } from "react-router";
import { useI18n } from "../i18n";
import { SECTIONS, sectionName, type SectionId } from "./sections";
import styles from "./MobileTabs.module.css";

const TABS: SectionId[] = ["home", "search", "library"];

/** The bottom navigation on phones, in place of the sidebar. */
export function MobileTabs() {
  const { t } = useI18n();
  return (
    <nav className={`glass ${styles.tabs}`} aria-label={t.shell.tabs}>
      {TABS.map((id) => {
        const { path, icon: Icon } = SECTIONS[id];
        return (
          <NavLink key={id} to={path} end={id === "home"} className={styles.tab}>
            <Icon className={styles.icon} />
            <span>{sectionName(t, id)}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
