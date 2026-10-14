import { PHONE } from "../lib/useMediaQuery";

/** The window is a phone's for the test: the phone's layout's parts are rendered. */
export function asPhone() {
  const original = window.matchMedia;
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => {
    const list = original(query);
    return query === PHONE ? ({ ...list, matches: true } as MediaQueryList) : list;
  });
}
