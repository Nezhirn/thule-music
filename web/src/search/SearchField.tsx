import { LoaderCircle, Search, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { IconButton } from "../ui/IconButton";
import { clean } from "./match";
import styles from "./SearchField.module.css";

/** Typing pauses this long (ms) before it searches. */
export const DEBOUNCE = 250;

interface Props {
  /** What the page searches for (from its address). */
  query: string;
  onSearch(query: string): void;
  /** A search is on its way. */
  busy: boolean;
  autoFocus: boolean;
}

/** The search field: searches as you type, once typing pauses, or at once with Enter. */
export function SearchField({ query, onSearch, busy, autoFocus }: Props) {
  const { t } = useI18n();
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(query);
  // The last query searched for from here: another one came from elsewhere (back, a link).
  const [searched, setSearched] = useState(query);
  if (query !== searched) {
    setSearched(query);
    setText(query);
  }

  const search = useCallback(
    (next: string) => {
      setSearched(next);
      onSearch(next);
    },
    [onSearch],
  );

  useEffect(() => {
    const next = clean(text);
    if (next === searched) return;
    const timer = window.setTimeout(() => search(next), DEBOUNCE);
    return () => window.clearTimeout(timer);
  }, [text, searched, search]);

  return (
    <form
      role="search"
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        search(clean(text));
        // Touch screens: the keyboard goes away to show the results.
        if (window.matchMedia("(hover: none)").matches) input.current?.blur();
      }}
    >
      <label htmlFor={id} className="visually-hidden">
        {t.search.field}
      </label>
      {busy ? (
        <LoaderCircle className={`${styles.icon} ${styles.busy}`} aria-hidden="true" />
      ) : (
        <Search className={styles.icon} aria-hidden="true" />
      )}
      <input
        ref={input}
        id={id}
        type="search"
        value={text}
        placeholder={t.search.placeholder}
        maxLength={200}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        aria-keyshortcuts="/ Control+K Meta+K"
        data-search-field
        autoFocus={autoFocus}
        className={styles.input}
        onChange={(event) => setText(event.target.value)}
      />
      {text !== "" && (
        <IconButton
          icon={X}
          label={t.search.clear}
          size="sm"
          className={styles.clear}
          onClick={() => {
            setText("");
            search("");
            input.current?.focus();
          }}
        />
      )}
    </form>
  );
}
