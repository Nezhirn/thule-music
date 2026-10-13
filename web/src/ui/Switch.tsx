import { useId } from "react";
import styles from "./Switch.module.css";

interface Props {
  label: string;
  description?: string;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
}

/** An on/off setting: its name and what it does on the left, the switch on the right. */
export function Switch({ label, description, checked, onChange, disabled }: Props) {
  const id = useId();
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <label htmlFor={id} className={styles.label}>
          {label}
        </label>
        {description && (
          <p id={`${id}-note`} className={styles.note}>
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-note` : undefined}
        disabled={disabled}
        className={styles.switch}
        onClick={() => onChange(!checked)}
      >
        <span className={styles.thumb} />
      </button>
    </div>
  );
}
