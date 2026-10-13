import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SessionProvider } from "./auth/SessionProvider";
import { I18nProvider } from "./i18n/I18nProvider";
import { LikesProvider } from "./likes/LikesProvider";
import type { AudioLike } from "./player/player";
import { PlayerProvider } from "./player/PlayerProvider";
import { ThemeProvider } from "./theme/ThemeProvider";

export function AppProviders({
  queryClient,
  audio,
  children,
}: {
  queryClient: QueryClient;
  /** For tests: a fake <audio> element for the player. */
  audio?: AudioLike;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SessionProvider>
          <PlayerProvider audio={audio}>
            <LikesProvider>
              <ThemeProvider>{children}</ThemeProvider>
            </LikesProvider>
          </PlayerProvider>
        </SessionProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
