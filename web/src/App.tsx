import { useEffect, useState } from "react";
import { api } from "./api/client";
import styles from "./App.module.css";

type ServerState = "checking" | "needs-setup" | "ready" | "unreachable";

const MESSAGES: Record<ServerState, string> = {
  checking: "Connecting to the server…",
  "needs-setup": "Server is up. First run: create the administrator account.",
  ready: "Server is up.",
  unreachable: "Server is unreachable.",
};

// Placeholder for stage 0: proves the build, the proxy and the typed client work end to end.
// The real shell replaces it in stage 1.
export function App() {
  const [state, setState] = useState<ServerState>("checking");

  useEffect(() => {
    api.GET("/api/v1/auth/setup").then(
      ({ data }) => setState(data ? (data.needs_setup ? "needs-setup" : "ready") : "unreachable"),
      () => setState("unreachable"),
    );
  }, []);

  return (
    <main className={styles.page}>
      <h1>Thule Music</h1>
      <p role="status" data-state={state}>
        {MESSAGES[state]}
      </p>
    </main>
  );
}
