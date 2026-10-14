// localStorage that falls back to memory when the browser refuses it (some privacy modes
// throw on access): the app keeps working, it just forgets on reload.
const memory = new Map<string, string>();

export const storage = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key) ?? memory.get(key) ?? null;
    } catch {
      return memory.get(key) ?? null;
    }
  },
  /** False when the browser refused it (full, or no storage at all): kept in memory for
   * this page only, and what the browser held before for `key` is removed, so a later load
   * doesn't read an older value as current. */
  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      memory.delete(key);
      return true;
    } catch {
      memory.set(key, value);
      try {
        localStorage.removeItem(key);
      } catch {
        // no storage at all
      }
      return false;
    }
  },
  remove(key: string): void {
    memory.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      // no storage at all
    }
  },
};
