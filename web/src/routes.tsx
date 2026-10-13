import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { useMe } from "./account/me";
import { LoginPage, type LoginState } from "./auth/LoginPage";
import { useSession } from "./auth/session";
import { SetupPage } from "./auth/SetupPage";
import { AlbumPage } from "./pages/AlbumPage";
import { AlbumsPage } from "./pages/AlbumsPage";
import { ArtistPage } from "./pages/ArtistPage";
import { ArtistsPage } from "./pages/ArtistsPage";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { PlaceholderPage } from "./pages/PlaceholderPage";
import { TracksPage } from "./pages/TracksPage";
import { SettingsPage } from "./settings/SettingsPage";
import { AppShell } from "./shell/AppShell";
import { Splash } from "./ui/Splash";
import { Unreachable } from "./ui/Unreachable";

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AnonymousOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
      </Route>
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="search" element={<PlaceholderPage section="search" />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="albums" element={<AlbumsPage />} />
          <Route path="albums/:id" element={<AlbumPage />} />
          <Route path="artists" element={<ArtistsPage />} />
          <Route path="artists/:id" element={<ArtistPage />} />
          <Route path="tracks" element={<TracksPage />} />
          <Route path="liked" element={<PlaceholderPage section="liked" />} />
          <Route path="history" element={<PlaceholderPage section="history" />} />
          <Route path="playlists/:id" element={<PlaceholderPage section="playlists" />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="admin"
            element={
              <AdminOnly>
                <PlaceholderPage section="admin" />
              </AdminOnly>
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function RequireSession() {
  const session = useSession();
  const location = useLocation();
  if (session.status === "restoring") return <Splash />;
  if (session.status === "unreachable") return <Unreachable onRetry={session.retry} />;
  if (session.status === "anonymous") {
    const state: LoginState = { from: location.pathname + location.search };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

function AnonymousOnly() {
  const session = useSession();
  const state = useLocation().state as LoginState | null;
  if (session.status === "restoring") return <Splash />;
  if (session.status === "unreachable") return <Unreachable onRetry={session.retry} />;
  if (session.status === "authenticated") return <Navigate to={state?.from ?? "/"} replace />;
  return <Outlet />;
}

function AdminOnly({ children }: { children: ReactNode }) {
  return useMe()?.role === "admin" ? children : <Navigate to="/" replace />;
}
