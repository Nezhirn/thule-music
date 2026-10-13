import { useState } from "react";
import { BrowserRouter } from "react-router";
import { AppProviders } from "./AppProviders";
import { createQueryClient } from "./queryClient";
import { AppRoutes } from "./routes";

export function App() {
  const [queryClient] = useState(createQueryClient);
  return (
    <AppProviders queryClient={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppProviders>
  );
}
