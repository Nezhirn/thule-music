import { createContext, useContext } from "react";
import type { EndReason } from "./tokens";

/** restoring: checking a stored session with the server; unreachable: there is a stored
 * session, but the server can't be reached to check it. */
export type SessionStatus = "restoring" | "anonymous" | "authenticated" | "unreachable";

export interface Session {
  status: SessionStatus;
  /** Why the previous session ended, to explain it on the sign-in page. */
  ended: EndReason | null;
  /** Throws ApiFailure (wrong password, throttled, ...) or a network error. */
  signIn(username: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  /** Checks the stored session again (after `unreachable`). */
  retry(): void;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside SessionProvider");
  return session;
}
