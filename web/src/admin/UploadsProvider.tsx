import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import { useSession } from "../auth/session";
import { useI18n } from "../i18n";
import { announce } from "../ui/toast";
import { libraryChanged } from "./queries";
import { sendFile } from "./send";
import { createUploads, inProgress } from "./uploads";
import { UploadsContext } from "./uploadsContext";

/** Music being uploaded by an administrator: goes on while they use the rest of the app,
 * stops when they sign out. */
export function UploadsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { status } = useSession();
  const [uploads] = useState(() =>
    createUploads({
      send: sendFile,
      status: (paths) => unwrap(api.POST("/api/v1/library/uploads/status", { body: { paths } })),
      finished() {
        libraryChanged(queryClient);
        void queryClient.invalidateQueries({ queryKey: ["admin"] });
      },
    }),
  );

  // Says how the uploads went once they are all done, wherever the admin is in the app.
  useEffect(
    () =>
      uploads.store.subscribe(({ finished }, previous) => {
        if (finished && finished !== previous.finished) {
          announce(t.admin.uploads.finished(finished.added, finished.failed));
        }
      }),
    [uploads, t],
  );

  useEffect(() => {
    if (status === "anonymous") uploads.reset();
  }, [uploads, status]);

  // Leaving while files are on their way asks first. Listened to only then: a listener
  // keeps some browsers from caching the page for going back.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    let warning = false;
    const unsubscribe = uploads.store.subscribe(({ items }) => {
      const busy = items.some(inProgress);
      if (busy === warning) return;
      warning = busy;
      if (busy) window.addEventListener("beforeunload", warn);
      else window.removeEventListener("beforeunload", warn);
    });
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", warn);
    };
  }, [uploads]);

  return <UploadsContext value={uploads}>{children}</UploadsContext>;
}
