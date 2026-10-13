import { useRef, useState, type FormEvent } from "react";
import { useChangePassword } from "../account/profile";
import { ApiFailure, errorMessage } from "../api/errors";
import { newPasswordProblem, problemText, type Problem } from "../auth/validation";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TextField } from "../ui/TextField";
import styles from "./Settings.module.css";

type FieldName = "current" | "next" | "confirm";
const EMPTY: Record<FieldName, string> = { current: "", next: "", confirm: "" };

export function PasswordSettings() {
  const { t } = useI18n();
  const text = t.settings.password;
  const change = useChangePassword();
  const [values, setValues] = useState(EMPTY);
  const [problems, setProblems] = useState<Partial<Record<FieldName, Problem>>>({});
  const [done, setDone] = useState(false);
  const currentInput = useRef<HTMLInputElement>(null);
  const nextInput = useRef<HTMLInputElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);

  const wrongPassword =
    change.error instanceof ApiFailure && change.error.code === "wrong_password";
  const field = (name: FieldName) => ({
    value: values[name],
    onChange: (event: { target: { value: string } }) => {
      setValues((current) => ({ ...current, [name]: event.target.value }));
      setDone(false);
    },
    error: problems[name] ? problemText(t, problems[name]) : null,
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: Partial<Record<FieldName, Problem>> = {
      current: values.current ? undefined : "required",
      next: newPasswordProblem(values.next),
      confirm:
        values.confirm === values.next
          ? undefined
          : values.confirm
            ? "passwordsDiffer"
            : "required",
    };
    setProblems(found);
    if (found.current) return currentInput.current?.focus();
    if (found.next) return nextInput.current?.focus();
    if (found.confirm) return confirmInput.current?.focus();
    change.mutate(
      { current_password: values.current, new_password: values.next },
      {
        onSuccess: () => {
          setValues(EMPTY);
          setDone(true);
        },
        onError: (error) => {
          if (error instanceof ApiFailure && error.code === "wrong_password") {
            setValues((current) => ({ ...current, current: "" }));
            currentInput.current?.focus();
          }
        },
      },
    );
  }

  return (
    <Card title={text.title}>
      {done && <Alert tone="info">{text.changed}</Alert>}
      {change.isError && !wrongPassword && (
        <Alert tone="error">{errorMessage(t, change.error)}</Alert>
      )}
      <form className={styles.field} onSubmit={submit} noValidate>
        <TextField
          ref={currentInput}
          label={text.current}
          type="password"
          autoComplete="current-password"
          {...field("current")}
          error={
            problems.current
              ? problemText(t, problems.current)
              : wrongPassword
                ? errorMessage(t, change.error)
                : null
          }
        />
        <TextField
          ref={nextInput}
          label={text.new}
          type="password"
          autoComplete="new-password"
          {...field("next")}
        />
        <TextField
          ref={confirmInput}
          label={text.confirm}
          type="password"
          autoComplete="new-password"
          {...field("confirm")}
        />
        <Button
          type="submit"
          className={styles.end}
          busyLabel={change.isPending && text.submitting}
        >
          {text.submit}
        </Button>
      </form>
    </Card>
  );
}
