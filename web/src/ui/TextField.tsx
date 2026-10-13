import { useId, type InputHTMLAttributes, type Ref, type TextareaHTMLAttributes } from "react";
import styles from "./TextField.module.css";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Shown after the label, e.g. "optional". */
  note?: string;
  error?: string | null;
  ref?: Ref<HTMLInputElement>;
}

export function TextField({ label, note, error, ref, ...input }: Props) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {note && <span className={styles.note}> · {note}</span>}
      </label>
      <input
        ref={ref}
        id={id}
        className={styles.input}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...input}
      />
      {error && (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}

/** A field for a few lines of text. */
export function TextArea({
  label,
  note,
  ...textarea
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; note?: string }) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {note && <span className={styles.note}> · {note}</span>}
      </label>
      <textarea id={id} rows={3} className={`${styles.input} ${styles.area}`} {...textarea} />
    </div>
  );
}
