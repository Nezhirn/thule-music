import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Outlet, useLocation, useNavigationType } from "react-router";
import { useMe } from "../account/me";
import { useI18n } from "../i18n";
import { PHONE, useMediaQuery } from "../lib/useMediaQuery";
import { EditsProvider } from "../edits/EditsProvider";
import { AddToPlaylistProvider } from "../playlists/AddToPlaylist";
import { useFailureNotice, useSpaceToPlay } from "../player/hooks";
import { useSearchShortcut } from "../search/shortcut";
import { Backdrop } from "../theme/Backdrop";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { Toast } from "../ui/Toast";
import styles from "./AppShell.module.css";
import { PageCrashed } from "./Crashed";
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
  const { pathname, key } = useLocation();
  const navigation = useNavigationType();
  const visited = useRef(pathname);
  // Where each page visited was scrolled to, for coming back to it (Back).
  const scrolled = useRef(new Map<string, number>());
  const shown = useRef(key);
  const [tint, setTint] = useState<string | null>(null);
  // The queue over the page (narrower windows) and the phone's full player.
  const [queueOpen, setQueueOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const closeQueue = useCallback(() => {
    setQueueOpen(false);
    document.getElementById(QUEUE_TOGGLE)?.focus();
  }, []);
  const closePlayer = useCallback(() => setPlayerOpen(false), []);
  const phone = useMediaQuery(PHONE);
  useSpaceToPlay();
  useFailureNotice();
  useSearchShortcut();

  // A new page starts at its top, and keyboard and screen reader users land on it, as on a
  // full page load (not on the first one: focus stays where the browser puts it), unless
  // the page put them in a field of its own (search). Back (and Forward) to a page comes
  // back to where it was scrolled to.
  // Before the new page is painted: a scroll it causes (a shorter page) is its own.
  useLayoutEffect(() => {
    shown.current = key;
  }, [key]);
  useEffect(() => {
    if (visited.current === pathname) return;
    visited.current = pathname;
    if (!main.current) return;
    const back = navigation === "POP" ? scrolled.current.get(key) : undefined;
    if (back === undefined) main.current.scrollTop = 0;
    else restoreScroll(main.current, back);
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement && main.current.contains(focused)) return;
    main.current.focus({ preventScroll: true });
  }, [pathname, key, navigation]);

  if (!me) return null;
  return (
    <AddToPlaylistProvider>
      <EditsProvider>
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
            <main
              id="content"
              ref={main}
              tabIndex={-1}
              className={styles.content}
              onScroll={(event) => remember(scrolled.current, shown.current, event.currentTarget)}
            >
              <PageTintContext value={setTint}>
                <ErrorBoundary
                  resetKey={pathname}
                  fallback={(retry) => <PageCrashed onRetry={retry} />}
                >
                  <Outlet />
                </ErrorBoundary>
              </PageTintContext>
            </main>
          </div>
          <NowPlaying open={queueOpen} onClose={closeQueue} />
          <PlayerBar queueOpen={queueOpen} onToggleQueue={() => setQueueOpen(!queueOpen)} />
          {/* Phones' only: hidden elsewhere, they would still render as the track plays. */}
          {phone && <MiniPlayer onOpen={() => setPlayerOpen(true)} />}
          <MobileTabs />
          {phone && <FullPlayer open={playerOpen} onClose={closePlayer} />}
          <Toast />
        </div>
      </EditsProvider>
    </AddToPlaylistProvider>
  );
}

// Pages whose place is kept, the latest.
const KEPT_PLACES = 50;

function remember(places: Map<string, number>, key: string, main: HTMLElement) {
  places.delete(key);
  places.set(key, main.scrollTop);
  if (places.size > KEPT_PLACES) places.delete(places.keys().next().value!);
}

/** Scrolls back to `top` once the page is that long: a list loaded again from the cache
 * comes at once, one loading takes a moment (given up after a couple of seconds). */
function restoreScroll(main: HTMLElement, top: number) {
  const until = Date.now() + 2000;
  const attempt = () => {
    main.scrollTop = top;
    if (Math.abs(main.scrollTop - top) > 1 && Date.now() < until) requestAnimationFrame(attempt);
  };
  attempt();
}
