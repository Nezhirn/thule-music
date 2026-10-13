import { useEffect, useRef } from "react";
import { Outlet, useLocation } from "react-router";
import { useMe } from "../account/me";
import { useI18n } from "../i18n";
import { Backdrop } from "../theme/Backdrop";
import styles from "./AppShell.module.css";
import { MobileTabs } from "./MobileTabs";
import { NowPlaying } from "./NowPlaying";
import { PlayerBar } from "./PlayerBar";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/** The signed-in app: navigation on the left (at the bottom on phones), the page in the
 * middle, what plays on the right, the player along the bottom. */
export function AppShell() {
  const { t } = useI18n();
  const me = useMe();
  const main = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const visited = useRef(pathname);

  // A new page starts at its top, and keyboard and screen reader users land on it, as on a
  // full page load (not on the first one: focus stays where the browser puts it).
  useEffect(() => {
    if (visited.current === pathname) return;
    visited.current = pathname;
    if (!main.current) return;
    main.current.scrollTop = 0;
    main.current.focus({ preventScroll: true });
  }, [pathname]);

  if (!me) return null;
  return (
    <div className={styles.shell}>
      <Backdrop />
      <a href="#content" className={styles.skip}>
        {t.shell.skipToContent}
      </a>
      <Sidebar admin={me.role === "admin"} />
      <div className={`glass ${styles.main}`}>
        <TopBar me={me} />
        <main id="content" ref={main} tabIndex={-1} className={styles.content}>
          <Outlet />
        </main>
      </div>
      <NowPlaying />
      <PlayerBar />
      <MobileTabs />
    </div>
  );
}
