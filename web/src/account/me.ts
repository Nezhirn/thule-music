import { useQuery } from "@tanstack/react-query";
import type { Schemas } from "../api/client";
import { meQuery } from "../auth/queries";

export type Me = Schemas["UserOut"];

/** The signed-in user, as loaded with the session (undefined once it ends). */
export function useMe(): Me | undefined {
  return useQuery({ ...meQuery, enabled: false }).data;
}

export function displayName(user: Me): string {
  return user.display_name ?? user.username;
}
