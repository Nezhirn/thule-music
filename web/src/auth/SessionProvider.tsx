import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { isSaving } from "../account/preferences";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import { useI18n } from "../i18n";
import { meQuery, preferencesQuery } from "./queries";
import { SessionContext, type Session, type SessionStatus } from "./session";
import * as tokens from "./tokens";

interface State {
  status: SessionStatus;
  ended: tokens.EndReason | null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { setLanguage } = useI18n();
  const [state, setState] = useState<State>(() => ({
    status: tokens.hasSession() ? "restoring" : "anonymous",
    ended: null,
  }));

  // Loads what every signed-in screen needs: the account, and its settings (the language).
  const load = useCallback(async () => {
    const [, preferences] = await Promise.all([
      queryClient.fetchQuery({ ...meQuery, retry: false }),
      queryClient.fetchQuery({ ...preferencesQuery, retry: false }),
    ]);
    // The account's language, unless it follows the device. Remembered on the device too, so
    // the next start shows it before the settings load.
    if (preferences.language) setLanguage(preferences.language);
  }, [queryClient, setLanguage]);

  const check = useCallback(async () => {
    try {
      await load();
      // Unless another tab signed out meanwhile.
      if (tokens.hasSession()) setState({ status: "authenticated", ended: null });
    } catch {
      // A session the server ended is reported by the subscription below; anything else
      // means it couldn't be checked.
      if (tokens.hasSession()) setState({ status: "unreachable", ended: null });
    }
  }, [load]);

  const restore = useCallback(() => {
    setState({ status: "restoring", ended: null });
    void check();
  }, [check]);

  useEffect(() => {
    // The state changes when the requests complete, not synchronously in the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (tokens.hasSession()) void check();
  }, [check]);

  useEffect(
    () =>
      tokens.subscribe((event) => {
        if (event.type === "started") {
          restore();
          return;
        }
        queryClient.clear();
        setState((current) =>
          current.status === "anonymous" ? current : { status: "anonymous", ended: event.reason },
        );
      }),
    [queryClient, restore],
  );

  // Changes made on other devices arrive when the user comes back to this tab, unless they
  // are changing something here at that moment.
  const authenticated = state.status === "authenticated";
  useQuery({ ...meQuery, enabled: authenticated, refetchOnWindowFocus: "always" });
  const accountLanguage = useQuery({
    ...preferencesQuery,
    enabled: authenticated,
    refetchOnWindowFocus: () => (isSaving(queryClient) ? false : "always"),
  }).data?.language;
  // The account's language, once changed on another device (or put back after a failed save).
  useEffect(() => {
    if (authenticated && accountLanguage) setLanguage(accountLanguage);
  }, [authenticated, accountLanguage, setLanguage]);

  const value = useMemo<Session>(
    () => ({
      ...state,
      async signIn(username, password) {
        const pair = await unwrap(api.POST("/api/v1/auth/login", { body: { username, password } }));
        tokens.startSession(pair);
        await load();
        setState({ status: "authenticated", ended: null });
      },
      async signOut() {
        await tokens.signOut();
      },
      retry: restore,
    }),
    [state, load, restore],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}
