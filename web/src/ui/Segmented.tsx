import { useId } from "react";
import styles from "./Segmented.module.css";
import { usePicked } from "./usePicked";

interface Option<T extends string> {
  value: T;
  label: string;
  /** The language of the label, when it differs from the page's. */
  lang?: string;
}

interface Props<T extends string> {
  /** Id of the element naming the group. */
  labelledBy: string;
  options: readonly Option<T>[];
  value: T;
  onChange(value: T): void;
}

/** One of a few options, side by side. Native radio buttons: arrow keys move the choice. */
export function Segmented<T extends string>({ labelledBy, options, value, onChange }: Props<T>) {
  const name = useId();
  const [shown, pick] = usePicked(value);
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className={styles.group}>
      {options.map((option) => (
        <label key={option.value} className={styles.option} lang={option.lang}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === shown}
            onChange={() => {
              pick(option.value);
              onChange(option.value);
            }}
            className={styles.input}
          />
          <span className={styles.text}>{option.label}</span>
        </label>
      ))}
    </div>
  );
}
