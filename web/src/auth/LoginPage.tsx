import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation } from "react-router";
import { ApiFailure, errorMessage } from "../api/errors";
import { useI18n, type Messages } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { CenteredLayout } from "../ui/CenteredLayout";
import { TextField } from "../ui/TextField";
import styles from "./forms.module.css";
import { setupQuery } from "./queries";
import { useSession } from "./session";
import { problemText, type Problem } from "./validation";

export interface LoginState {
  /** Where to go after signing in. */
  from?: string;
  /** setup-done: the first-run page found the server already set up. */
  notice?: "setup-done";
}

function failureText(t: Messages, error: unknown): string {
  if (error instanceof ApiFailure && error.code === "too_many_login_attempts" && error.retryAfter) {
    return t.auth.tryAgainIn(error.retryAfter);
  }
  return errorMessage(t, error);
}

export function LoginPage() {
  const { t } = useI18n();
  const session = useSession();
  const state = useLocation().state as LoginState | null;
  const setup = useQuery(setupQuery);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [problems, setProblems] = useState<{ username?: Problem; password?: Problem }>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);

  if (setup.data?.needs_setup) return <Navigate to="/setup" replace />;

  const notice =
    state?.notice === "setup-done"
      ? t.auth.setup.alreadyDone
      : session.ended && t.auth.ended[session.ended];

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = {
      username: username.trim() ? undefined : ("required" as const),
      password: password ? undefined : ("required" as const),
    };
    setProblems(found);
    if (found.username) return usernameInput.current?.focus();
    if (found.password) return passwordInput.current?.focus();

    setBusy(true);
    setFailure(null);
    try {
      await session.signIn(username.trim(), password);
    } catch (error) {
      setFailure(error);
      if (error instanceof ApiFailure && error.code === "invalid_credentials") {
        setPassword("");
        passwordInput.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <CenteredLayout>
      <h1 className={styles.title}>{t.auth.signIn.title}</h1>
      {failure !== null ? (
        <Alert tone="error">{failureText(t, failure)}</Alert>
      ) : setup.isError ? (
        <Alert tone="error">{t.common.unreachable}</Alert>
      ) : (
        notice && <Alert tone="info">{notice}</Alert>
      )}
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField
          ref={usernameInput}
          label={t.auth.username}
          name="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          error={problems.username && problemText(t, problems.username)}
        />
        <TextField
          ref={passwordInput}
          label={t.auth.password}
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={problems.password && problemText(t, problems.password)}
        />
        <Button type="submit" busyLabel={busy && t.auth.signIn.submitting}>
          {t.auth.signIn.submit}
        </Button>
      </form>
    </CenteredLayout>
  );
}
