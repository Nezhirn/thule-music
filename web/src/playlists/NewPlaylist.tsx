import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { PlaylistDialog } from "./PlaylistDialog";

/** Creates a playlist and opens it; `children` makes the button that starts it. */
export function NewPlaylist({ children }: { children(open: () => void): ReactNode }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      {children(() => setOpen(true))}
      <PlaylistDialog
        open={open}
        onClose={() => setOpen(false)}
        onDone={(playlist) => {
          setOpen(false);
          void navigate(`/playlists/${playlist.id}`);
        }}
      />
    </>
  );
}
