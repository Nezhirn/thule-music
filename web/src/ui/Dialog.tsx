import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { DialogHold, useDialogHeld } from "./dialogHold";
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
  /** Held open: what it does is on its way (see also useHoldDialog). */
  busy?: boolean;
  children: ReactNode;
}

/** A modal dialog: the page behind can't be used until it closes. Opens with the focus on
 * its first control, and gives it back on closing to what had it. The content is made
 * afresh each time it opens. While what it does is on its way to the server (see
 * useHoldDialog), Escape and a click outside don't close it: what follows the answer
 * (opening the merged album's page) would be lost. */
export function Dialog({ open, onClose, title, description, wide, busy, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [holders, setHolders] = useState<ReadonlySet<string>>(new Set());
  const held = holders.size > 0 || Boolean(busy);
  const hold = useCallback((id: string, on: boolean) => {
    setHolders((current) => {
      if (current.has(id) === on) return current;
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const holding = useMemo(() => ({ held, hold }), [held, hold]);
  // Where the pointer went down: a click "on the backdrop" that started inside (selecting
  // text past the edge) isn't one.
  const pressed = useRef<EventTarget | null>(null);

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
      onCancel={(event) => {
        if (held) event.preventDefault();
      }}
      onPointerDown={(event) => {
        pressed.current = event.target;
      }}
      onClick={(event) => {
        // The backdrop: the dialog's own box is all padding-free content.
        const backdrop = event.target === event.currentTarget;
        if (backdrop && pressed.current === event.currentTarget && !held) onClose();
        pressed.current = null;
      }}
    >
      {open && (
        <DialogHold value={holding}>
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
        </DialogHold>
      )}
    </dialog>
  );
}

/** A dialog's button that closes it without doing anything: off while what it does is on
 * its way. */
export function DialogCancel({ onClick, children }: { onClick(): void; children: ReactNode }) {
  const held = useDialogHeld();
  return (
    <Button variant="secondary" disabled={held} onClick={onClick}>
      {children}
    </Button>
  );
}

/** The buttons along the bottom of a dialog. */
export function DialogButtons({ children }: { children: ReactNode }) {
  return <div className={styles.buttons}>{children}</div>;
}
