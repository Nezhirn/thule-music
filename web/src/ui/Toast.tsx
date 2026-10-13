import { useEffect } from "react";
import { useStore } from "zustand";
import { toastStore } from "./toast";
import styles from "./Toast.module.css";

// How long a message stays (ms).
const SHOWN_FOR = 4000;

/** Where announce() messages show. The live region is always there, so that screen readers
 * notice what appears in it. */
export function Toast() {
  const { message, count } = useStore(toastStore);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => toastStore.setState({ message: null }), SHOWN_FOR);
    return () => clearTimeout(timer);
  }, [message, count]);
  return (
    <div role="status" className={styles.region}>
      {message && (
        <p key={count} className={styles.toast}>
          {message}
        </p>
      )}
    </div>
  );
}
