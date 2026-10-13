import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Outlet, useLocation } from "react-router";
import { useMe } from "../account/me";
import { useI18n } from "../i18n";
import { AddToPlaylistProvider } from "../playlists/AddToPlaylist";
import { useFailureNotice, useSpaceToPlay } from "../player/hooks";
import { Backdrop } from "../theme/Backdrop";
import { Toast } from "../ui/Toast";
import styles from "./AppShell.module.css";
import { FullPlayer } from "./FullPlayer";
import { MiniPlayer } from "./MiniPlayer";
import { MobileTabs } from "./MobileTabs";
import { NowPlaying } from "./NowPlaying";
import { PageTintContext } from "./pageTint";
import { PlayerBar, QUEUE_TOGGLE } from "./PlayerBar";
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
  const [tint, setTint] = useState<string | null>(null);
  // The queue over the page (narrower windows) and the phone's full player.
  const [queueOpen, setQueueOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const closeQueue = useCallback(() => {
    setQueueOpen(false);
    document.getElementById(QUEUE_TOGGLE)?.focus();
  }, []);
  const closePlayer = useCallback(() => setPlayerOpen(false), []);
  useSpaceToPlay();
  useFailureNotice();

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
    <AddToPlaylistProvider>
      <div className={styles.shell}>
        <Backdrop />
        <a href="#content" className={styles.skip}>
          {t.shell.skipToContent}
        </a>
        <Sidebar admin={me.role === "admin"} />
        <div
          className={`glass ${styles.main}`}
          style={{ "--page-tint": tint ?? "transparent" } as CSSProperties}
        >
          <div className={styles.tint} aria-hidden="true" />
          <TopBar me={me} />
          <main id="content" ref={main} tabIndex={-1} className={styles.content}>
            <PageTintContext value={setTint}>
              <Outlet />
            </PageTintContext>
          </main>
        </div>
        <NowPlaying open={queueOpen} onClose={closeQueue} />
        <PlayerBar queueOpen={queueOpen} onToggleQueue={() => setQueueOpen(!queueOpen)} />
        <MiniPlayer onOpen={() => setPlayerOpen(true)} />
        <MobileTabs />
        <FullPlayer open={playerOpen} onClose={closePlayer} />
        <Toast />
      </div>
    </AddToPlaylistProvider>
  );
}
