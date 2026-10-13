import { useQuery } from "@tanstack/react-query";
import { ChevronRight, ListMusic } from "lucide-react";
import { Link } from "react-router";
import { useI18n } from "../i18n";
import { playlistsQuery } from "../shell/queries";
import { LIBRARY_SECTIONS, SECTIONS, sectionName } from "../shell/sections";
import { PageHeader } from "../ui/PageHeader";
import styles from "./LibraryPage.module.css";

/** The library's sections and the playlists: the sidebar's content, for phones. */
export function LibraryPage() {
  const { t } = useI18n();
  const playlists = useQuery(playlistsQuery);
  return (
    <>
      <PageHeader title={t.nav.library} />
      <ul className={styles.list}>
        {LIBRARY_SECTIONS.map((id) => {
          const { path, icon: Icon } = SECTIONS[id];
          return (
            <li key={id}>
              <Link to={path} className={styles.row}>
                <Icon className={styles.icon} />
                <span className={styles.label}>{sectionName(t, id)}</span>
                <ChevronRight className={styles.chevron} />
              </Link>
            </li>
          );
        })}
      </ul>
      <h2 className={styles.heading}>{t.nav.playlists}</h2>
      {playlists.isError && <p className={styles.note}>{t.nav.playlistsFailed}</p>}
      {playlists.data?.length === 0 && <p className={styles.note}>{t.nav.noPlaylists}</p>}
      {playlists.data && playlists.data.length > 0 && (
        <ul className={styles.list}>
          {playlists.data.map((playlist) => (
            <li key={playlist.id}>
              <Link to={`/playlists/${playlist.id}`} className={styles.row}>
                <ListMusic className={styles.icon} />
                <span className={styles.label}>{playlist.name}</span>
                <ChevronRight className={styles.chevron} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
