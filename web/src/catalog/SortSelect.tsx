import { ChevronDown } from "lucide-react";
import { useId } from "react";
import styles from "./SortSelect.module.css";

interface Props<T extends string> {
  label: string;
  value: T;
  options: readonly T[];
  names: Record<T, string>;
  onChange(value: T): void;
}

/** A labelled native select: compact, and as accessible as it gets on every platform. */
export function SortSelect<T extends string>({ label, value, options, names, onChange }: Props<T>) {
  const id = useId();
  return (
    <span className={styles.sort}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <span className={styles.field}>
        <select
          id={id}
          className={styles.select}
          value={value}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {names[option]}
            </option>
          ))}
        </select>
        <ChevronDown className={styles.chevron} aria-hidden="true" />
      </span>
    </span>
  );
}
