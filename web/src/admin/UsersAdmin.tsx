import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  LogOut,
  MoreHorizontal,
  Plus,
  ShieldCheck,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { useId, useRef, useState, type FormEvent } from "react";
import { useMe } from "../account/me";
import { api, type Schemas } from "../api/client";
import { ApiFailure, errorMessage, unwrap } from "../api/errors";
import {
  newPasswordProblem,
  newUsernameProblem,
  problemText,
  type Problem,
} from "../auth/validation";
import { LoadError } from "../catalog/LoadError";
import { PageLoading } from "../catalog/PageStatus";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Dialog, DialogButtons } from "../ui/Dialog";
import { Menu, MenuItem } from "../ui/Menu";
import { Segmented } from "../ui/Segmented";
import { TextField } from "../ui/TextField";
import { announce } from "../ui/toast";
import { ago, date } from "./format";
import { usersQuery, type AdminUser } from "./queries";
import styles from "./admin.module.css";

type Role = Schemas["Role"];
type Action = "password" | "signOut" | "remove";

/** The accounts on the server: who they are, when they were last here, and what an
 * administrator can do about them. */
export function UsersAdmin() {
  const { t } = useI18n();
  const text = t.admin.users;
  const users = useQuery(usersQuery);
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState<{ action: Action; user: AdminUser } | null>(null);
  const close = () => setActing(null);

  return (
    <div className={styles.cards}>
      <Card title={text.title}>
        <Button className={styles.start} onClick={() => setCreating(true)}>
          <Plus className={styles.buttonIcon} aria-hidden />
          {text.add}
        </Button>
        {users.isPending ? (
          <PageLoading />
        ) : users.isError ? (
          <LoadError error={users.error} onRetry={() => void users.refetch()} />
        ) : (
          <ul className={styles.users}>
            {users.data.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                onAction={(action) => setActing({ action, user })}
              />
            ))}
          </ul>
        )}
      </Card>
      <Dialog open={creating} onClose={() => setCreating(false)} title={text.create.title}>
        <CreateUser onDone={() => setCreating(false)} />
      </Dialog>
      <Dialog
        open={acting?.action === "password"}
        onClose={close}
        title={acting ? text.password.title(nameOf(acting.user)) : ""}
        description={text.password.text}
      >
        {acting && <SetPassword user={acting.user} onDone={close} />}
      </Dialog>
      <Dialog
        open={acting?.action === "signOut"}
        onClose={close}
        title={acting ? text.signOutDialog.title(nameOf(acting.user)) : ""}
        description={text.signOutDialog.text}
      >
        {acting && <SignOut user={acting.user} onDone={close} />}
      </Dialog>
      <Dialog
        open={acting?.action === "remove"}
        onClose={close}
        title={acting ? text.removeDialog.title(nameOf(acting.user)) : ""}
        description={text.removeDialog.text}
      >
        {acting && <Remove user={acting.user} onDone={close} />}
      </Dialog>
    </div>
  );
}

const nameOf = (user: AdminUser) => user.display_name ?? user.username;

function UserRow({ user, onAction }: { user: AdminUser; onAction(action: Action): void }) {
  const { t, language } = useI18n();
  const text = t.admin.users;
  const me = useMe();
  const queryClient = useQueryClient();
  const self = me?.id === user.id;
  const role = useMutation({
    mutationFn: (next: Role) =>
      unwrap(
        api.PATCH("/api/v1/users/{username}", {
          params: { path: { username: user.username } },
          body: { role: next },
        }),
      ),
    onSuccess: (changed) => announce(text.roleChanged(nameOf(user), text.roles[changed.role])),
    onError: (error) => announce(errorMessage(t, error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: usersQuery.queryKey }),
  });

  return (
    <li className={styles.user}>
      <Avatar id={user.avatar_id} size={44} />
      <div className={styles.userText}>
        <p className={styles.userName}>
          {nameOf(user)}
          {self && <span className={styles.badge}>{text.you}</span>}
        </p>
        <p className={styles.note}>
          {user.display_name && `${user.username} · `}
          {text.roles[user.role]} · {text.since(date(language, new Date(user.created_at)))}
        </p>
        <p className={styles.note}>
          {user.last_seen_at
            ? text.lastSeen(ago(language, new Date(user.last_seen_at)))
            : text.neverSeen}
          {user.sessions > 0 && ` · ${text.sessions(user.sessions)}`}
        </p>
      </div>
      {!self && (
        <Menu
          label={text.actions(nameOf(user))}
          trigger={<MoreHorizontal className={styles.menuIcon} />}
          triggerClassName={styles.menuTrigger}
        >
          {user.role === "admin" ? (
            <MenuItem icon={ShieldOff} onSelect={() => role.mutate("user")}>
              {text.makeUser}
            </MenuItem>
          ) : (
            <MenuItem icon={ShieldCheck} onSelect={() => role.mutate("admin")}>
              {text.makeAdmin}
            </MenuItem>
          )}
          <MenuItem icon={KeyRound} onSelect={() => onAction("password")}>
            {text.setPassword}
          </MenuItem>
          <MenuItem icon={LogOut} onSelect={() => onAction("signOut")}>
            {text.signOut}
          </MenuItem>
          <MenuItem icon={Trash2} onSelect={() => onAction("remove")}>
            {text.remove}
          </MenuItem>
        </Menu>
      )}
    </li>
  );
}

type Field = "username" | "password";

function CreateUser({ onDone }: { onDone(): void }) {
  const { t } = useI18n();
  const text = t.admin.users;
  const queryClient = useQueryClient();
  const roleLabel = useId();
  const [values, setValues] = useState({ username: "", displayName: "", password: "" });
  const [role, setRole] = useState<Role>("user");
  const [problems, setProblems] = useState<Partial<Record<Field, Problem>>>({});
  const [taken, setTaken] = useState(false);
  const usernameInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const create = useMutation({
    mutationFn: (body: Schemas["RegisterIn"]) =>
      unwrap(api.POST("/api/v1/auth/register", { body })),
    onSuccess: (user) => {
      announce(text.create.done(user.username));
      void queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });
      onDone();
    },
    onError: (error) => {
      if (error instanceof ApiFailure && error.code === "username_taken") {
        setTaken(true);
        usernameInput.current?.focus();
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const username = values.username.trim();
    const found = {
      username: newUsernameProblem(username),
      password: newPasswordProblem(values.password),
    };
    setProblems(found);
    setTaken(false);
    if (found.username) return usernameInput.current?.focus();
    if (found.password) return passwordInput.current?.focus();
    create.mutate({
      username,
      password: values.password,
      display_name: values.displayName.trim() || null,
      role,
    });
  };
  const change = (name: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [name]: event.target.value }));

  return (
    <form className={styles.form} noValidate onSubmit={submit}>
      {create.isError && !taken && <Alert tone="error">{errorMessage(t, create.error)}</Alert>}
      <TextField
        ref={usernameInput}
        label={t.auth.username}
        value={values.username}
        onChange={change("username")}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        maxLength={64}
        error={
          problems.username
            ? problemText(t, problems.username)
            : taken
              ? t.errors.username_taken
              : null
        }
      />
      <TextField
        label={text.create.displayName}
        note={t.common.optional}
        value={values.displayName}
        onChange={change("displayName")}
        autoComplete="off"
        maxLength={128}
      />
      <TextField
        ref={passwordInput}
        label={t.auth.password}
        type="password"
        value={values.password}
        onChange={change("password")}
        autoComplete="new-password"
        error={problems.password ? problemText(t, problems.password) : null}
      />
      <div className={styles.roleField}>
        <span id={roleLabel} className={styles.fieldLabel}>
          {text.create.role}
        </span>
        <Segmented<Role>
          labelledBy={roleLabel}
          options={[
            { value: "user", label: text.roles.user },
            { value: "admin", label: text.roles.admin },
          ]}
          value={role}
          onChange={setRole}
        />
      </div>
      <DialogButtons>
        <Button variant="secondary" onClick={onDone}>
          {text.cancel}
        </Button>
        <Button type="submit" busyLabel={create.isPending && text.create.submitting}>
          {text.create.submit}
        </Button>
      </DialogButtons>
    </form>
  );
}

function SetPassword({ user, onDone }: { user: AdminUser; onDone(): void }) {
  const { t } = useI18n();
  const text = t.admin.users.password;
  const queryClient = useQueryClient();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<Problem | undefined>();
  const input = useRef<HTMLInputElement>(null);
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/users/{username}/password", {
          params: { path: { username: user.username } },
          body: { new_password: password },
        }),
      ),
    onSuccess: () => {
      announce(text.done(nameOf(user)));
      void queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });
      onDone();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const found = newPasswordProblem(password);
    setProblem(found);
    if (found) return input.current?.focus();
    save.mutate();
  };
  return (
    <form className={styles.form} noValidate onSubmit={submit}>
      {save.isError && <Alert tone="error">{errorMessage(t, save.error)}</Alert>}
      <TextField
        ref={input}
        label={text.field}
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="new-password"
        error={problem ? problemText(t, problem) : null}
      />
      <DialogButtons>
        <Button variant="secondary" onClick={onDone}>
          {t.admin.users.cancel}
        </Button>
        <Button type="submit" busyLabel={save.isPending && text.submitting}>
          {text.submit}
        </Button>
      </DialogButtons>
    </form>
  );
}

/** A confirmation: Cancel, or the action (which closes the dialog either way). */
function Confirm({
  submit,
  submitting,
  run,
  onDone,
}: {
  submit: string;
  submitting: string;
  run(): Promise<unknown>;
  onDone(): void;
}) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: run,
    onError: (error) => announce(errorMessage(t, error)),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: usersQuery.queryKey });
      onDone();
    },
  });
  return (
    <DialogButtons>
      <Button variant="secondary" onClick={onDone}>
        {t.admin.users.cancel}
      </Button>
      <Button busyLabel={action.isPending && submitting} onClick={() => action.mutate()}>
        {submit}
      </Button>
    </DialogButtons>
  );
}

function SignOut({ user, onDone }: { user: AdminUser; onDone(): void }) {
  const { t } = useI18n();
  const text = t.admin.users.signOutDialog;
  return (
    <Confirm
      submit={text.submit}
      submitting={text.submitting}
      onDone={onDone}
      run={async () => {
        await unwrap(
          api.DELETE("/api/v1/users/{username}/sessions", {
            params: { path: { username: user.username } },
          }),
        );
        announce(text.done(nameOf(user)));
      }}
    />
  );
}

function Remove({ user, onDone }: { user: AdminUser; onDone(): void }) {
  const { t } = useI18n();
  const text = t.admin.users.removeDialog;
  return (
    <Confirm
      submit={text.submit}
      submitting={text.submitting}
      onDone={onDone}
      run={async () => {
        await unwrap(
          api.DELETE("/api/v1/users/{username}", {
            params: { path: { username: user.username } },
          }),
        );
        announce(text.done(nameOf(user)));
      }}
    />
  );
}
