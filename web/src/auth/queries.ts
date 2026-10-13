import { queryOptions } from "@tanstack/react-query";
import { api } from "../api/client";
import { unwrap } from "../api/errors";

export const setupQuery = queryOptions({
  queryKey: ["setup"],
  queryFn: () => unwrap(api.GET("/api/v1/auth/setup")),
});

export const meQuery = queryOptions({
  queryKey: ["me"],
  queryFn: () => unwrap(api.GET("/api/v1/auth/me")),
  staleTime: Infinity,
});

export const preferencesQuery = queryOptions({
  queryKey: ["preferences"],
  queryFn: () => unwrap(api.GET("/api/v1/me/preferences")),
  staleTime: Infinity,
});
