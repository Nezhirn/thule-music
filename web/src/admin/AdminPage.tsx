import { NavLink, Outlet, useLocation } from "react-router";
import { useI18n } from "../i18n";
import { PageHeader } from "../ui/PageHeader";
import styles from "./admin.module.css";

const TABS = [
  { id: "library", path: "/admin" },
  { id: "uploads", path: "/admin/uploads" },
  { id: "users", path: "/admin/users" },
] as const;

/** Administration: its sections as tabs, each at its own address. */
export function AdminPage() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const current = TABS.find((tab) => tab.path === pathname.replace(/\/$/, "")) ?? TABS[0];
  return (
    <>
      <PageHeader
        title={t.nav.admin}
        documentTitle={`${t.admin.tabs[current.id]} · ${t.nav.admin}`}
      />
      <nav aria-label={t.admin.sections} className={styles.tabs}>
        <ul className={styles.tabList}>
          {TABS.map((tab) => (
            <li key={tab.id}>
              <NavLink to={tab.path} end className={styles.tab}>
                {t.admin.tabs[tab.id]}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </>
  );
}
