import { useState } from "react";

/** For a choice whose `value` updates a moment after the user picks (saved settings): the
 * picked option shows at once, then follows `value` whenever it changes, to the same option
 * once the change is applied, or back if it is refused. Without this a native radio button
 * would snap back for a moment, and a screen reader would announce it unchecked. */
export function usePicked<T>(value: T): [T, (picked: T) => void] {
  const [owner, setOwner] = useState(value);
  const [picked, setPicked] = useState(value);
  if (owner !== value) {
    setOwner(value);
    setPicked(value);
  }
  return [owner === value ? picked : value, setPicked];
}
