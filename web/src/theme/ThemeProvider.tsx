import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { preferencesQuery } from "../auth/queries";
import { useSession } from "../auth/session";
import { selectTrack, usePlayer } from "../player/context";
import { ThemeContext, type CoverPalette, type Theme } from "./context";
import { accentTokens, ambientColors, DEFAULT_ACCENT, SIGN_IN_AMBIENT } from "./theme";

/** Applies the signed-in user's appearance settings (the defaults otherwise): the accent as
 * CSS variables on the document, blur as `data-blur` on it, and the backdrop colours. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const signedIn = status === "authenticated";
  const preferences = useQuery({ ...preferencesQuery, enabled: signedIn }).data;
  const playing = usePlayer((state) => selectTrack(state)?.album.cover_palette ?? null);
  const [coverPreview, previewCover] = useState<CoverPalette | null>(null);
  const [accentPreview, previewAccent] = useState<string | null>(null);

  const accent = accentPreview ?? preferences?.accent_color ?? DEFAULT_ACCENT;
  const blur = preferences?.blur ?? true;
  // The cover being tried on in the settings, or else the playing track's.
  const palette = (preferences?.adaptive_color ?? true) ? (coverPreview ?? playing) : null;

  useLayoutEffect(() => {
    const root = document.documentElement;
    const tokens = accentTokens(accent);
    root.style.setProperty("--accent", tokens.accent);
    root.style.setProperty("--accent-hover", tokens.accentHover);
    root.style.setProperty("--accent-on", tokens.accentOn);
    root.style.setProperty("--accent-text", tokens.accentText);
    root.dataset.blur = blur ? "on" : "off";
  }, [accent, blur]);

  const value = useMemo<Theme>(
    () => ({
      ambient: signedIn ? ambientColors(accent, palette) : SIGN_IN_AMBIENT,
      blur,
      previewCover,
      previewAccent,
    }),
    [signedIn, accent, palette, blur],
  );
  return <ThemeContext value={value}>{children}</ThemeContext>;
}
