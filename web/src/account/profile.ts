import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import { meQuery } from "../auth/queries";
import * as tokens from "../auth/tokens";
import type { Me } from "./me";

/** The server's limit for a photo. */
export const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

function useSetMe() {
  const queryClient = useQueryClient();
  return (me: Me) => queryClient.setQueryData(meQuery.queryKey, me);
}

export function useRename() {
  const setMe = useSetMe();
  return useMutation({
    // Blank resets to the username.
    mutationFn: (displayName: string) =>
      unwrap(api.PATCH("/api/v1/auth/me", { body: { display_name: displayName } })),
    onSuccess: setMe,
  });
}

export function useUploadAvatar() {
  const setMe = useSetMe();
  return useMutation({
    mutationFn: (file: File) =>
      unwrap(
        api.PUT("/api/v1/auth/me/avatar", {
          // The generated type says string for a binary field; the serializer sends the file.
          body: { file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append("file", file);
            return form;
          },
        }),
      ),
    onSuccess: setMe,
  });
}

export function useRemoveAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(api.DELETE("/api/v1/auth/me/avatar")),
    onSuccess: () =>
      queryClient.setQueryData(meQuery.queryKey, (me) => me && { ...me, avatar_id: null }),
  });
}

/** Changes the password. The server ends every other session and hands this one new tokens. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { current_password: string; new_password: string }) =>
      unwrap(api.POST("/api/v1/auth/me/password", { body })),
    onSuccess: tokens.startSession,
  });
}
