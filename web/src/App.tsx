import { useState } from "react";
import { BrowserRouter } from "react-router";
import { AppProviders } from "./AppProviders";
import { createQueryClient } from "./queryClient";
import { AppRoutes } from "./routes";
import { AppCrashed } from "./shell/Crashed";
import { ErrorBoundary } from "./ui/ErrorBoundary";

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <ErrorBoundary fallback={() => <AppCrashed />}>
      <AppProviders queryClient={queryClient}>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AppProviders>
    </ErrorBoundary>
  );
}
