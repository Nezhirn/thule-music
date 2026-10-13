import { createContext, useContext } from "react";
import type { Schemas } from "../api/base";

export type CoverPalette = Schemas["CoverPalette"];

export interface Theme {
  /** The three backdrop colours (#rrggbb). */
  ambient: readonly [string, string, string];
  /** Frosted glass; off, panels are opaque. */
  blur: boolean;
  /** Tints the UI after this cover for now (null: after what plays again). Stable. */
  previewCover(palette: CoverPalette | null): void;
  /** Shows this accent until the setting is saved (null: the saved one again). Stable. */
  previewAccent(color: string | null): void;
}

export const ThemeContext = createContext<Theme | null>(null);

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme outside ThemeProvider");
  return theme;
}
