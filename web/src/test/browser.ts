// What jsdom lacks and the app uses. Observers that never report: tests use the controls
// they stand in for (the "Show more" button instead of scrolling to it).
class InertObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

globalThis.ResizeObserver ??= InertObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= InertObserver as unknown as typeof IntersectionObserver;
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

// Modal dialogs: open and close, without the top layer or the focus trap.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  if (!this.open) return;
  this.open = false;
  this.dispatchEvent(new Event("close"));
};
