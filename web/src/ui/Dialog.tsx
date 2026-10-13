import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./Dialog.module.css";

interface Props {
  open: boolean;
  /** Escape, a click outside, or the dialog's own buttons. */
  onClose(): void;
  title: string;
  /** Under the title: what the dialog is about. */
  description?: ReactNode;
  /** Room for a long text to edit. */
  wide?: boolean;
  children: ReactNode;
}

/** A modal dialog: the page behind can't be used until it closes. Opens with the focus on
 * its first control, and gives it back on closing to what had it. The content is made
 * afresh each time it opens. */
export function Dialog({ open, onClose, title, description, wide, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={wide ? `${styles.dialog} ${styles.wide}` : styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => {
        onClose();
        if (opener.current?.isConnected) opener.current.focus();
        opener.current = null;
      }}
      onClick={(event) => {
        // The backdrop: the dialog's own box is all padding-free content.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className={styles.body}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className={styles.description}>
              {description}
            </p>
          )}
          {children}
        </div>
      )}
    </dialog>
  );
}

/** The buttons along the bottom of a dialog. */
export function DialogButtons({ children }: { children: ReactNode }) {
  return <div className={styles.buttons}>{children}</div>;
}
