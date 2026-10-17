import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, ListFilter, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useI18n } from "../i18n";
import { clean } from "../search/match";
import { DEBOUNCE } from "../search/SearchField";
import { Button } from "../ui/Button";
import { EmptyState } from "../ui/EmptyState";
import {
  filterOptionsQuery,
  isFiltered,
  NO_FILTERS,
  type Facet,
  type FilterScope,
  type Filters,
} from "./filters";
import styles from "./FilterBar.module.css";

interface Props {
  /** The list filtered. */
  scope: FilterScope;
  facets: readonly Facet[];
  filters: Filters;
  onChange(facet: Facet, value: string | null): void;
  onClear(): void;
}

/** A list's filters: a button for each, opening its choices; and one clearing them all. */
export function FilterBar({ scope, facets, filters, onChange, onClear }: Props) {
  const { t } = useI18n();
  return (
    <div role="group" aria-label={t.filters.label} className={styles.bar} data-filter-bar>
      {facets.map((facet) => (
        <FilterPicker
          key={facet}
          facet={facet}
          scope={scope}
          filters={filters}
          onChange={(value) => onChange(facet, value)}
        />
      ))}
      {isFiltered(filters) && (
        <button
          type="button"
          className={styles.reset}
          onClick={() => {
            onClear();
            focusFilters();
          }}
        >
          {t.filters.clear}
        </button>
      )}
    </div>
  );
}

/** In place of a list the filters left empty. */
export function NothingFiltered({ onClear }: { onClear(): void }) {
  const { t } = useI18n();
  return (
    <EmptyState icon={ListFilter} title={t.filters.nothing}>
      {t.filters.nothingText}{" "}
      <Button
        variant="secondary"
        size="small"
        className={styles.clearAll}
        onClick={() => {
          onClear();
          focusFilters();
        }}
      >
        {t.filters.clear}
      </Button>
    </EmptyState>
  );
}

/** On the first filter's button: the button clearing them goes away once they are. */
function focusFilters() {
  document.querySelector<HTMLElement>("[data-filter-bar] button")?.focus();
}

/** Where what is inside `element` stops showing on the right: the edge of the nearest
 * ancestor that clips its content, else of the window. */
function clippedRight(element: HTMLElement): number {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowX !== "visible") return node.getBoundingClientRect().right;
  }
  return window.innerWidth;
}

interface Entry {
  value: string | null;
  name: string;
  detail?: string | null;
  count?: number;
}

/** A filter's button and its choices: a search field over a list, the keyboard's as in a
 * combobox (arrows move, Enter picks, Escape closes). The choices come from the server, as
 * many as there are of what is left with the other filters set. */
function FilterPicker({
  facet,
  scope,
  filters,
  onChange,
}: {
  facet: Facet;
  scope: FilterScope;
  filters: Filters;
  onChange(value: string | null): void;
}) {
  const { t } = useI18n();
  const id = useId();
  const listId = `${id}-list`;
  const value = filters[facet];
  const label = t.filters[facet];
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  // Where the arrows or the pointer moved; until then, the current choice.
  const [moved, setMoved] = useState<number | null>(null);
  // The choice just picked, named until the server names it.
  const [picked, setPicked] = useState<Entry | null>(null);
  // Genres are one in any case ("rock" in a link, "Rock" in the list).
  const same = (a: string | null, b: string | null) =>
    facet === "genre" ? a?.toLowerCase() === b?.toLowerCase() : a === b;

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setText("");
    setQ("");
    setMoved(null);
    if (refocus) button.current?.focus();
  }, []);

  // What it is set to, named: asked for apart from the choices (none of them, `limit` 0),
  // so another filter changing doesn't take the name away while they load.
  const named = useQuery({
    ...filterOptionsQuery(facet, scope, { ...NO_FILTERS, [facet]: value }, "", 0),
    enabled: value !== null,
  });
  const name =
    named.data?.selected?.name ??
    (picked && same(picked.value, value) ? picked.name : null) ??
    // Not found (an artist since removed): its id, rather than nothing.
    (facet === "genre" || !named.isPending ? value : null);

  const options = useQuery({
    ...filterOptionsQuery(facet, scope, filters, q),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const entries: Entry[] = [
    // What is typed is looked for: Enter picks the first found, not "all".
    ...(q ? [] : [{ value: null, name: t.filters.all[facet] }]),
    ...(options.data?.items ?? []),
  ];
  const chosen = entries.findIndex((entry) => same(entry.value, value));
  // The list may have become shorter than where the arrows were.
  const current = Math.min(moved ?? (!q && chosen >= 0 ? chosen : 0), entries.length - 1);

  useEffect(() => {
    const next = clean(text);
    if (next === q) return;
    const timer = window.setTimeout(() => {
      setQ(next);
      setMoved(null);
    }, DEBOUNCE);
    return () => window.clearTimeout(timer);
  }, [text, q]);

  // Where there is no room on the right (a button near the edge of the panel), the choices
  // open leftwards, as far as they must.
  useLayoutEffect(() => {
    const element = popup.current;
    if (!open || !element) return;
    element.style.removeProperty("left");
    const overflow = element.getBoundingClientRect().right - (clippedRight(element) - 8);
    if (overflow > 0) element.style.left = `${-overflow}px`;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popup.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-${current}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, current, id]);

  const pick = (entry: Entry) => {
    close(true);
    if (same(entry.value, value)) return;
    setPicked(entry);
    onChange(entry.value);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const last = entries.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => setMoved(Math.min(current + 1, last)),
      ArrowUp: () => setMoved(Math.max(current - 1, 0)),
      Enter: () => {
        // Typed faster than it is looked for: it is looked for now, and a second Enter
        // picks from what is found.
        const typed = clean(text);
        if (typed !== q) {
          setQ(typed);
          setMoved(null);
          return;
        }
        const entry = entries[current];
        if (entry && !options.isPlaceholderData) pick(entry);
      },
      Escape: () => close(true),
    };
    if (event.key === "Tab") close(false);
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  const shown = options.data?.items.length ?? 0;
  const total = options.data?.total ?? 0;
  return (
    <div className={styles.wrap}>
      <div className={styles.chip} data-set={value ? "" : undefined}>
        <button
          ref={button}
          type="button"
          className={styles.open}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listId : undefined}
          onClick={() => (open ? close(false) : setOpen(true))}
        >
          {value ? (
            <>
              <span className={styles.facet}>{label}:</span>{" "}
              <span className={styles.value}>{name ?? "…"}</span>
            </>
          ) : (
            label
          )}
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        </button>
        {value && (
          <button
            type="button"
            className={styles.remove}
            aria-label={t.filters.remove(label, name ?? value)}
            onClick={() => {
              onChange(null);
              button.current?.focus();
            }}
          >
            <X aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div ref={popup} className={styles.popup}>
          <div className={styles.search}>
            <Search className={styles.searchIcon} aria-hidden="true" />
            <input
              // Typing straight away is what the button is for.
              autoFocus
              type="search"
              role="combobox"
              className={styles.input}
              value={text}
              placeholder={t.filters.find(label)}
              aria-label={t.filters.find(label)}
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={current >= 0 ? `${id}-${current}` : undefined}
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <ul id={listId} role="listbox" aria-label={label} className={styles.list}>
            {entries.map((entry, i) => (
              <li
                key={entry.value ?? ""}
                id={`${id}-${i}`}
                role="option"
                aria-selected={same(entry.value, value)}
                data-active={i === current || undefined}
                className={styles.option}
                // The focus stays in the field.
                onPointerDown={(event) => event.preventDefault()}
                onPointerMove={() => setMoved(i)}
                onClick={() => pick(entry)}
              >
                <span className={styles.names}>
                  <span className={styles.name}>{entry.name}</span>
                  {entry.detail && <span className={styles.detail}>{entry.detail}</span>}
                </span>
                {entry.count !== undefined && <span className={styles.count}>{entry.count}</span>}
                <Check
                  className={styles.check}
                  aria-hidden="true"
                  data-shown={same(entry.value, value) || undefined}
                />
              </li>
            ))}
          </ul>
          {options.isPending && <p className={styles.note}>{t.filters.loading}</p>}
          {options.isError && (
            <p className={styles.note}>
              {t.catalog.loadFailed}{" "}
              <button type="button" className={styles.retry} onClick={() => void options.refetch()}>
                {t.common.retry}
              </button>
            </p>
          )}
          {options.isSuccess && q && shown === 0 && <p className={styles.note}>{t.filters.none}</p>}
          {shown < total && <p className={styles.note}>{t.filters.more(shown, total)}</p>}
        </div>
      )}
    </div>
  );
}
