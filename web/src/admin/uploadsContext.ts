import { createContext, useContext } from "react";
import { useStore } from "zustand";
import type { Uploads, UploadsState } from "./uploads";

export const UploadsContext = createContext<Uploads | null>(null);

export function useUploads(): Uploads {
  const uploads = useContext(UploadsContext);
  if (!uploads) throw new Error("useUploads outside UploadsProvider");
  return uploads;
}

/** The uploads as they go. */
export function useUploadsState(): UploadsState {
  return useStore(useUploads().store);
}
