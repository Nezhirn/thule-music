import { createContext, useContext, useEffect, useId } from "react";

interface Holding {
  /** Something in the dialog is on its way to the server. */
  held: boolean;
  hold(id: string, on: boolean): void;
}

export const DialogHold = createContext<Holding | null>(null);

/** Whether the dialog this is in is held open. */
export function useDialogHeld(): boolean {
  return useContext(DialogHold)?.held ?? false;
}

/** Keeps the dialog this is in open while `pending`: what the dialog does after the answer
 * (closing, opening another page) runs only while it is there. Outside a dialog, nothing. */
export function useHoldDialog(pending: boolean) {
  const holding = useContext(DialogHold);
  const id = useId();
  const hold = holding?.hold;
  useEffect(() => {
    if (!hold) return;
    hold(id, pending);
    return () => hold(id, false);
  }, [hold, id, pending]);
}
