import type { LucideIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import styles from "./Menu.module.css";

const CloseContext = createContext<() => void>(() => {});

interface Props {
  /** The accessible name of the button. */
  label: string;
  /** What the button shows. */
  trigger: ReactNode;
  /** Shown above the items, e.g. who is signed in. */
  header?: ReactNode;
  /** Replaces the button's own look. */
  triggerClassName?: string;
  children: ReactNode;
}

/** A button opening a list of actions, with the keyboard behaviour of the WAI-ARIA menu
 * button: arrows move between the items, Escape closes and returns to the button. */
export function Menu({ label, trigger, header, triggerClassName, children }: Props) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  // Which item to focus once open: the first, or the last (opened with the up arrow).
  const [open, setOpen] = useState<"first" | "last" | null>(null);

  // Opens upwards where there is no room below (a button near the bottom of the window).
  useLayoutEffect(() => {
    if (!open || !popup.current || !button.current) return;
    const { top, bottom } = button.current.getBoundingClientRect();
    const below = window.innerHeight - bottom;
    popup.current.toggleAttribute("data-up", below < popup.current.offsetHeight + 8 && top > below);
  }, [open]);

  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
  const close = (refocus: boolean) => {
    setOpen(null);
    if (refocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const list = items();
    (open === "first" ? list[0] : list.at(-1))?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onButtonKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(event.key === "ArrowDown" ? "first" : "last");
    }
  };

  const onMenuKey = (event: KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => list[(i + list.length) % list.length]?.focus();
    const keys: Record<string, () => void> = {
      ArrowDown: () => focus(index + 1),
      ArrowUp: () => focus(index - 1),
      Home: () => focus(0),
      End: () => focus(list.length - 1),
      Escape: () => close(true),
    };
    if (event.key === "Tab") setOpen(null);
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  return (
    <div className={styles.wrap}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        aria-controls={open ? id : undefined}
        className={triggerClassName ?? styles.trigger}
        onClick={() => setOpen(open ? null : "first")}
        onKeyDown={onButtonKey}
      >
        {trigger}
      </button>
      {open && (
        <div ref={popup} className={styles.popup}>
          {header && <div className={styles.header}>{header}</div>}
          <div ref={menu} id={id} role="menu" aria-label={label} onKeyDown={onMenuKey}>
            <CloseContext value={() => close(false)}>{children}</CloseContext>
          </div>
        </div>
      )}
    </div>
  );
}

export function MenuLink({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const close = useContext(CloseContext);
  return (
    <Link to={to} role="menuitem" tabIndex={-1} className={styles.item} onClick={close}>
      <Icon className={styles.icon} />
      {children}
    </Link>
  );
}

export function MenuItem({
  onSelect,
  icon: Icon,
  children,
}: {
  onSelect(): void;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const close = useContext(CloseContext);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={styles.item}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      <Icon className={styles.icon} />
      {children}
    </button>
  );
}
