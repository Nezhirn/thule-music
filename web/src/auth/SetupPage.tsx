import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { api } from "../api/client";
import { ApiFailure, errorMessage, unwrap } from "../api/errors";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { CenteredLayout } from "../ui/CenteredLayout";
import { Splash } from "../ui/Splash";
import { TextField } from "../ui/TextField";
import { Unreachable } from "../ui/Unreachable";
import styles from "./forms.module.css";
import type { LoginState } from "./LoginPage";
import { setupQuery } from "./queries";
import { useSession } from "./session";
import { newPasswordProblem, newUsernameProblem, problemText, type Problem } from "./validation";

type Field = "username" | "displayName" | "password" | "confirm";

/** First run: the server has no accounts yet, create the administrator. */
export function SetupPage() {
  const { t } = useI18n();
  const session = useSession();
  const queryClient = useQueryClient();
  const setup = useQuery(setupQuery);
  const [values, setValues] = useState<Record<Field, string>>({
    username: "",
    displayName: "",
    password: "",
    confirm: "",
  });
  const [problems, setProblems] = useState<Partial<Record<Field, Problem>>>({});
  const [failure, setFailure] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);

  if (setup.isPending) return <Splash />;
  if (setup.isError) return <Unreachable onRetry={() => void setup.refetch()} />;
  if (!setup.data.needs_setup) {
    const state: LoginState = { notice: "setup-done" };
    return <Navigate to="/login" replace state={state} />;
  }

  const field = (name: Field) => ({
    name,
    value: values[name],
    onChange: (event: { target: { value: string } }) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
    error: problems[name] && problemText(t, problems[name]),
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    const username = values.username.trim();
    const found: Partial<Record<Field, Problem>> = {
      username: newUsernameProblem(username),
      password: newPasswordProblem(values.password),
      confirm:
        values.confirm === values.password
          ? undefined
          : values.confirm
            ? "passwordsDiffer"
            : "required",
    };
    setProblems(found);
    if (found.username) return usernameInput.current?.focus();
    if (found.password) return passwordInput.current?.focus();
    if (found.confirm) return confirmInput.current?.focus();

    setBusy(true);
    setFailure(null);
    try {
      await unwrap(
        api.POST("/api/v1/auth/register", {
          body: {
            username,
            password: values.password,
            display_name: values.displayName.trim() || undefined,
          },
        }),
      );
    } catch (error) {
      setBusy(false);
      if (error instanceof ApiFailure && error.code === "registration_closed") {
        // Someone else finished the setup first: off to the sign-in page (see above).
        queryClient.setQueryData(setupQuery.queryKey, { needs_setup: false });
      } else {
        setFailure(error);
      }
      return;
    }
    try {
      await session.signIn(username, values.password);
    } catch (error) {
      setFailure(error);
      setBusy(false);
    }
  }

  return (
    <CenteredLayout>
      <div className={styles.heading}>
        <h1 className={styles.title}>{t.auth.setup.title}</h1>
        <p className={styles.lead}>{t.auth.setup.lead}</p>
      </div>
      {failure !== null && <Alert tone="error">{errorMessage(t, failure)}</Alert>}
      <form className={styles.form} onSubmit={submit} noValidate>
        <TextField
          ref={usernameInput}
          label={t.auth.username}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          {...field("username")}
        />
        <TextField
          label={t.auth.setup.displayName}
          note={t.common.optional}
          autoComplete="name"
          {...field("displayName")}
        />
        <TextField
          ref={passwordInput}
          label={t.auth.password}
          type="password"
          autoComplete="new-password"
          {...field("password")}
        />
        <TextField
          ref={confirmInput}
          label={t.auth.setup.confirmPassword}
          type="password"
          autoComplete="new-password"
          {...field("confirm")}
        />
        <Button type="submit" busyLabel={busy && t.auth.setup.submitting}>
          {t.auth.setup.submit}
        </Button>
      </form>
    </CenteredLayout>
  );
}
