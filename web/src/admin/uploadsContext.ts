import { createContext, useContext } from "react";
import type { Uploads } from "./uploads";

export const UploadsContext = createContext<Uploads | null>(null);

export function useUploads(): Uploads {
  const uploads = useContext(UploadsContext);
  if (!uploads) throw new Error("useUploads outside UploadsProvider");
  return uploads;
}
