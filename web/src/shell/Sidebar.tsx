import { useQuery } from "@tanstack/react-query";
import { ListMusic, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink } from "react-router";
import { useI18n } from "../i18n";
import { NewPlaylist } from "../playlists/NewPlaylist";
import { playlistsQuery } from "../playlists/queries";
import { IconButton } from "../ui/IconButton";
import { Logo } from "../ui/Logo";
import { LIBRARY_SECTIONS, SECTIONS, sectionName, type SectionId } from "./sections";
import styles from "./Sidebar.module.css";

export function Sidebar({ admin }: { admin: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`glass ${styles.sidebar}`}>
      <nav aria-label={t.shell.navigation} className={styles.nav}>
        <Link to="/" className={styles.logo}>
          <Logo />
        </Link>
        <ul className={styles.list}>
          <SectionLink id="home" />
          <SectionLink id="search" />
        </ul>
        <Group title={t.nav.library}>
          {LIBRARY_SECTIONS.map((id) => (
            <SectionLink key={id} id={id} />
          ))}
        </Group>
        <Group
          title={t.nav.playlists}
          action={
            <NewPlaylist>
              {(open) => (
                <IconButton
                  icon={Plus}
                  label={t.playlists.new}
                  size="sm"
                  className={styles.add}
                  onClick={open}
                />
              )}
            </NewPlaylist>
          }
        >
          <Playlists />
        </Group>
        {admin && (
          <ul className={`${styles.list} ${styles.bottom}`}>
            <SectionLink id="admin" />
          </ul>
        )}
      </nav>
    </div>
  );
}

function Group({
  title,
  action,
  children,
}: {
  title: string;
  /** A button by the title. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h2 className={styles.groupTitle}>{title}</h2>
        {action}
      </div>
      <ul className={styles.list}>{children}</ul>
    </div>
  );
}

function SectionLink({ id }: { id: SectionId }) {
  const { t } = useI18n();
  const { path, icon: Icon } = SECTIONS[id];
  return (
    <li>
      <NavLink to={path} end className={styles.link}>
        <Icon className={styles.icon} />
        <span className={styles.label}>{sectionName(t, id)}</span>
      </NavLink>
    </li>
  );
}

function Playlists() {
  const { t } = useI18n();
  const playlists = useQuery(playlistsQuery);
  if (playlists.isPending) return null;
  if (playlists.isError) return <li className={styles.note}>{t.nav.playlistsFailed}</li>;
  if (playlists.data.length === 0) return <li className={styles.note}>{t.nav.noPlaylists}</li>;
  return playlists.data.map((playlist) => (
    <li key={playlist.id}>
      <NavLink to={`/playlists/${playlist.id}`} className={styles.link}>
        <ListMusic className={styles.icon} />
        <span className={styles.label}>{playlist.name}</span>
      </NavLink>
    </li>
  ));
}
