import type { Messages } from "../i18n";

// Mirrors the server's rules for new accounts (RegisterIn), so mistakes show at once.
const USERNAME = /^[A-Za-z0-9_.-]+$/;
export const PASSWORD_MIN_LENGTH = 8;

/** A field's problem, kept as a key so its text follows a language switch. */
export type Problem =
  "required" | "usernameLength" | "usernameChars" | "passwordLength" | "passwordsDiffer";

export function problemText(t: Messages, problem: Problem): string {
  const v = t.auth.validation;
  return problem === "passwordLength" ? v.passwordLength(PASSWORD_MIN_LENGTH) : v[problem];
}

export function newUsernameProblem(username: string): Problem | undefined {
  if (!username) return "required";
  if (username.length < 2 || username.length > 64) return "usernameLength";
  if (!USERNAME.test(username)) return "usernameChars";
  return undefined;
}

export function newPasswordProblem(password: string): Problem | undefined {
  if (!password) return "required";
  if (password.length < PASSWORD_MIN_LENGTH) return "passwordLength";
  return undefined;
}
