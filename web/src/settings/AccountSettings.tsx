import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { displayName, type Me } from "../account/me";
import { MAX_AVATAR_BYTES, useRemoveAvatar, useRename, useUploadAvatar } from "../account/profile";
import { errorMessage } from "../api/errors";
import { useI18n } from "../i18n";
import { Alert } from "../ui/Alert";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TextField } from "../ui/TextField";
import styles from "./AccountSettings.module.css";

export function AccountSettings({ me }: { me: Me }) {
  const { t } = useI18n();
  const text = t.settings.account;
  return (
    <Card title={text.title}>
      <div className={styles.who}>
        <Avatar id={me.avatar_id} size={72} />
        <div className={styles.names}>
          <span className={styles.name}>{displayName(me)}</span>
          <span className={styles.username}>
            @{me.username}
            {me.role === "admin" && <span className={styles.badge}>{t.auth.admin}</span>}
          </span>
        </div>
      </div>
      <Photo me={me} />
      <Rename me={me} />
    </Card>
  );
}

function Photo({ me }: { me: Me }) {
  const { t } = useI18n();
  const text = t.settings.account;
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const [tooLarge, setTooLarge] = useState(false);
  const failure = upload.error ?? remove.error;

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // the same file again is a new choice
    if (!file) return;
    setTooLarge(file.size > MAX_AVATAR_BYTES);
    if (file.size <= MAX_AVATAR_BYTES) upload.mutate(file);
  }

  return (
    <div className={styles.photo}>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={text.photo}
        hidden
        onChange={onFile}
      />
      <div className={styles.buttons}>
        <Button
          variant="secondary"
          size="small"
          busyLabel={upload.isPending && text.saving}
          onClick={() => input.current?.click()}
        >
          {me.avatar_id ? text.replace : text.upload}
        </Button>
        {me.avatar_id && (
          <Button
            variant="secondary"
            size="small"
            busyLabel={remove.isPending && text.saving}
            onClick={() => remove.mutate()}
          >
            {text.remove}
          </Button>
        )}
      </div>
      <p className={styles.hint}>{text.photoHint}</p>
      {tooLarge && <Alert tone="error">{text.photoTooLarge}</Alert>}
      {failure && !tooLarge && <Alert tone="error">{errorMessage(t, failure)}</Alert>}
    </div>
  );
}

function Rename({ me }: { me: Me }) {
  const { t } = useI18n();
  const text = t.settings.account;
  const rename = useRename();
  const saved = me.display_name ?? "";
  const [name, setName] = useState(saved);
  const changed = name.trim() !== saved;

  function submit(event: FormEvent) {
    event.preventDefault();
    rename.mutate(name, { onSuccess: (user) => setName(user.display_name ?? "") });
  }

  return (
    <form className={styles.rename} onSubmit={submit} noValidate>
      <TextField
        label={text.displayName}
        note={text.displayNameNote}
        autoComplete="name"
        maxLength={128}
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={rename.isError ? errorMessage(t, rename.error) : null}
      />
      <div className={styles.buttons}>
        <Button
          type="submit"
          size="small"
          disabled={!changed}
          busyLabel={rename.isPending && text.saving}
        >
          {text.save}
        </Button>
        <span role="status" className={styles.saved}>
          {rename.isSuccess && !changed && text.saved}
        </span>
      </div>
    </form>
  );
}
