import { MessageSquareQuote } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { useI18n } from "../i18n";
import { selectTrack, usePlayer } from "../player/context";
import { IconButton } from "../ui/IconButton";

/** Opens the lyrics of the playing track in place of the page, and closes them (back to the
 * page before). */
export function LyricsButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const playing = usePlayer((state) => selectTrack(state) !== null);
  const open = location.pathname === "/lyrics";
  return (
    <IconButton
      icon={MessageSquareQuote}
      label={t.lyrics.button}
      size="sm"
      aria-pressed={open}
      disabled={!playing && !open}
      className={className}
      onClick={() => {
        if (!open) void navigate("/lyrics");
        // Opened here: back to where it was opened from.
        else if (location.key !== "default") void navigate(-1);
        else void navigate("/");
      }}
    />
  );
}
