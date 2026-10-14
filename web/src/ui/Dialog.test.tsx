import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { Dialog, DialogCancel } from "./Dialog";
import { useHoldDialog } from "./dialogHold";

function Saving({ pending }: { pending: boolean }) {
  useHoldDialog(pending);
  return <input aria-label="Name" />;
}

function setup() {
  const onClose = vi.fn();
  function Harness() {
    const [pending, setPending] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setPending(!pending)}>
          toggle
        </button>
        <Dialog open onClose={onClose} title="Rename">
          <Saving pending={pending} />
          <DialogCancel onClick={onClose}>Cancel</DialogCancel>
        </Dialog>
      </>
    );
  }
  render(<Harness />);
  const dialog = document.querySelector("dialog")!;
  const escape = () => {
    const event = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const backdropClick = (from: Element = dialog) => {
    fireEvent.pointerDown(from);
    fireEvent.click(dialog);
  };
  return { onClose, dialog, escape, backdropClick };
}

test("a click on the backdrop closes it; one that started inside doesn't", () => {
  const { onClose, backdropClick } = setup();
  // Selecting the text of a field, let go past the dialog's edge.
  backdropClick(screen.getByRole("textbox", { name: "Name" }));
  expect(onClose).not.toHaveBeenCalled();
  backdropClick();
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("while what it does is on its way, it stays open", () => {
  const { onClose, escape, backdropClick } = setup();
  fireEvent.click(screen.getByRole("button", { name: "toggle", hidden: true }));
  expect(escape()).toBe(true);
  backdropClick();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel", hidden: true })).toBeDisabled();

  fireEvent.click(screen.getByRole("button", { name: "toggle", hidden: true }));
  expect(escape()).toBe(false);
  expect(screen.getByRole("button", { name: "Cancel", hidden: true })).toBeEnabled();
});
