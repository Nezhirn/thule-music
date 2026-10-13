import { queryOptions, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { api, type Schemas } from "../api/client";
import { coverUrl } from "../api/covers";
import { unwrap } from "../api/errors";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/context";
import { Field } from "./Field";
import styles from "./CoverPreview.module.css";

type Album = Schemas["AlbumOut"];
type CoveredAlbum = Album & { cover_id: string; cover_palette: Schemas["CoverPalette"] };

const recentAlbumsQuery = queryOptions({
  queryKey: ["albums", "recent"],
  queryFn: () =>
    unwrap(api.GET("/api/v1/albums", { params: { query: { limit: 24, sort: "added" } } })),
});

const covered = (album: Album): album is CoveredAlbum =>
  album.cover_id !== null && album.cover_palette !== null;

/** Recent albums to try the cover colours on before anything plays. Nothing without covers. */
export function CoverPreview() {
  const { t } = useI18n();
  const id = useId();
  const theme = useTheme();
  const albums = useQuery(recentAlbumsQuery);
  const [selected, setSelected] = useState<string | null>(null);
  const choices = (albums.data?.items ?? []).filter(covered).slice(0, 8);
  if (choices.length === 0) return null;

  return (
    <Field id={id} title={t.settings.appearance.preview} note={t.settings.appearance.previewNote}>
      <div role="group" aria-labelledby={id} className={styles.covers}>
        {choices.map((album) => (
          <button
            key={album.id}
            type="button"
            aria-pressed={album.id === selected}
            aria-label={`${album.title} — ${album.artist.name}`}
            title={`${album.title} — ${album.artist.name}`}
            className={styles.cover}
            onClick={() => {
              const off = album.id === selected;
              setSelected(off ? null : album.id);
              theme.previewCover(off ? null : album.cover_palette);
            }}
          >
            <img src={coverUrl(album.cover_id, 300)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    </Field>
  );
}
