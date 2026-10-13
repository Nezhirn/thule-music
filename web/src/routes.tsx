import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { LoginPage, type LoginState } from "./auth/LoginPage";
import { useSession } from "./auth/session";
import { SetupPage } from "./auth/SetupPage";
import { HomePage } from "./pages/HomePage";
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
        <Route index element={<HomePage />} />
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
