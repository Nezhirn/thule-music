import { createStore } from "zustand/vanilla";

/** The message on show; `count` tells the same message shown again apart. */
export const toastStore = createStore<{ message: string | null; count: number }>(() => ({
  message: null,
  count: 0,
}));

/** Shows a short message at the bottom for a few seconds; screen readers say it too. */
export function announce(message: string) {
  toastStore.setState((state) => ({ message, count: state.count + 1 }));
}
