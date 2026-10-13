import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { SessionProvider } from "./auth/SessionProvider";
import { I18nProvider } from "./i18n/I18nProvider";
import { ThemeProvider } from "./theme/ThemeProvider";

export function AppProviders({
  queryClient,
  children,
}: {
  queryClient: QueryClient;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SessionProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </SessionProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
