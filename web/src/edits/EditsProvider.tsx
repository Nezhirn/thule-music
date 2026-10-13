import { useState, type ReactNode } from "react";
import { useMe } from "../account/me";
import type { Track } from "../catalog/queries";
import { CoverDialog } from "./CoverDialog";
import { EditsContext, type CoverSubject, type Edits } from "./context";
import { LyricsDialog } from "./LyricsDialog";

/** The dialogs in which admins correct lyrics and covers, for the menus of the pages
 * inside. */
export function EditsProvider({ children }: { children: ReactNode }) {
  const admin = useMe()?.role === "admin";
  const [lyrics, setLyrics] = useState<Track | null>(null);
  const [cover, setCover] = useState<CoverSubject | null>(null);
  const [edits] = useState<Edits>(() => ({ editLyrics: setLyrics, editCover: setCover }));
  return (
    <EditsContext value={admin ? edits : null}>
      {children}
      {admin && (
        <>
          <LyricsDialog track={lyrics} onClose={() => setLyrics(null)} />
          <CoverDialog subject={cover} onClose={() => setCover(null)} />
        </>
      )}
    </EditsContext>
  );
}
