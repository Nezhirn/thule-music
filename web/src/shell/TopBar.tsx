import { LogOut, Settings, Shield } from "lucide-react";
import { Link } from "react-router";
import { displayName, type Me } from "../account/me";
import { useSession } from "../auth/session";
import { useI18n } from "../i18n";
import { Avatar } from "../ui/Avatar";
import { Logo } from "../ui/Logo";
import { Menu, MenuItem, MenuLink } from "../ui/Menu";
import styles from "./TopBar.module.css";

/** Above the content: the logo on phones (the sidebar has it otherwise), the account menu. */
export function TopBar({ me }: { me: Me }) {
  const { t } = useI18n();
  const session = useSession();
  const name = displayName(me);
  return (
    <header className={styles.bar}>
      <Link to="/" className={styles.logo}>
        <Logo />
      </Link>
      <Menu
        label={t.shell.account(name)}
        trigger={<Avatar id={me.avatar_id} size={32} />}
        header={
          <div className={styles.who}>
            <Avatar id={me.avatar_id} size={40} />
            <div className={styles.names}>
              <span className={styles.name}>{name}</span>
              <span className={styles.username}>
                @{me.username}
                {me.role === "admin" && ` · ${t.auth.admin}`}
              </span>
            </div>
          </div>
        }
      >
        <MenuLink to="/settings" icon={Settings}>
          {t.shell.settings}
        </MenuLink>
        {me.role === "admin" && (
          <MenuLink to="/admin" icon={Shield}>
            {t.nav.admin}
          </MenuLink>
        )}
        <MenuItem icon={LogOut} onSelect={() => void session.signOut()}>
          {t.auth.signOut}
        </MenuItem>
      </Menu>
    </header>
  );
}
