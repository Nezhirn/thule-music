import { useQuery } from "@tanstack/react-query";
import {
  FolderInput,
  ImagePlus,
  MoreHorizontal,
  Pencil,
  Shuffle,
  Trash2,
  Upload,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { useParams } from "react-router";
import { AlbumCard } from "../catalog/AlbumCard";
import { ArtistImage } from "../catalog/ArtistImage";
import { DetailHeader } from "../catalog/DetailHeader";
import { PageFailed, PageLoading, RefreshFailed } from "../catalog/PageStatus";
import { failedToLoad } from "../catalog/loaded";
import { artistQuery, type Album } from "../catalog/queries";
import { TrackTable } from "../catalog/TrackTable";
import { useEdits } from "../edits/context";
import { useI18n } from "../i18n";
import { FavouriteButton } from "../likes/LikeButton";
import { usePlayerControls } from "../player/context";
import { PlayButton } from "../player/PlayButton";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import iconButton from "../ui/IconButton.module.css";
import { Menu, MenuItem } from "../ui/Menu";
import grid from "../catalog/Grid.module.css";
import styles from "./CatalogPage.module.css";

// Popular tracks shown before "Show more".
const TOP = 5;

export function ArtistPage() {
  const { t } = useI18n();
  const { id = "" } = useParams();
  const query = useQuery(artistQuery(id));
  const [allTop, setAllTop] = useState(false);
  const player = usePlayerControls();
  const edits = useEdits();
  if (query.isPending) return <PageLoading />;
  if (failedToLoad(query)) {
    return (
      <PageFailed
        error={query.error}
        notFound={t.errors.artist_not_found}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const artist = query.data;
  const top = allTop ? artist.top_tracks : artist.top_tracks.slice(0, TOP);
  const palette = artist.cover_palette ?? artist.appears_on[0]?.cover_palette ?? null;
  // Plays the artist's popular tracks.
  const source = { type: "artist", id: artist.id } as const;
  const popular = artist.top_tracks;
  return (
    <>
      <RefreshFailed query={query} />
      <DetailHeader
        kind={t.catalog.artist}
        title={artist.name}
        palette={palette}
        art={
          <ArtistImage
            name={artist.name}
            coverId={artist.cover_id}
            sizes="(max-width: 899px) 64vw, 232px"
          />
        }
        actions={
          <>
            {popular.length > 0 && (
              <>
                <PlayButton source={source} name={artist.name} tracks={() => popular} />
                <IconButton
                  icon={Shuffle}
                  label={t.player.shuffleItem(artist.name)}
                  onClick={() => player.play(popular, { shuffle: true, source })}
                />
              </>
            )}
            <FavouriteButton kind="artist" item={artist} name={artist.name} />
            {edits && (
              <Menu
                label={t.player.trackActions(artist.name)}
                trigger={<MoreHorizontal className={iconButton.icon} />}
                triggerClassName={`${iconButton.button} ${iconButton.md}`}
              >
                <MenuItem icon={Pencil} onSelect={() => edits.renameArtist(artist)}>
                  {t.edits.renameArtist}
                </MenuItem>
                <MenuItem
                  icon={ImagePlus}
                  onSelect={() => edits.editCover({ kind: "artist", artist })}
                >
                  {t.edits.changePicture}
                </MenuItem>
                <MenuItem icon={Upload} onSelect={() => edits.uploadToArtist(artist)}>
                  {t.edits.uploadAlbum}
                </MenuItem>
                {artist.albums.length > 0 && (
                  <MenuItem
                    icon={FolderInput}
                    onSelect={() => edits.moveAlbums({ kind: "artist", artist })}
                  >
                    {t.edits.moveAlbums}
                  </MenuItem>
                )}
                <MenuItem icon={Trash2} onSelect={() => edits.deleteArtist(artist)}>
                  {t.edits.deleteArtist}
                </MenuItem>
              </Menu>
            )}
          </>
        }
      >
        {artist.album_count > 0 && <span>{t.catalog.albums(artist.album_count)}</span>}
      </DetailHeader>
      {top.length > 0 && (
        <Section title={t.catalog.topTracks}>
          <TrackTable
            tracks={top}
            queue={popular}
            label={t.catalog.topTracks}
            source={source}
            numbers="position"
            withAlbum
          />
          {artist.top_tracks.length > TOP && (
            <Button
              variant="secondary"
              size="small"
              className={styles.toggle}
              aria-expanded={allTop}
              onClick={() => setAllTop(!allTop)}
            >
              {allTop ? t.catalog.showLess : t.catalog.showMore}
            </Button>
          )}
        </Section>
      )}
      <Albums title={t.catalog.artistAlbums} albums={artist.albums} detail="year" />
      <Albums title={t.catalog.appearsOn} albums={artist.appears_on} />
    </>
  );
}

function Albums({ title, albums, detail }: { title: string; albums: Album[]; detail?: "year" }) {
  if (albums.length === 0) return null;
  return (
    <Section title={title}>
      <ul className={grid.grid}>
        {albums.map((album) => (
          <li key={album.id}>
            <AlbumCard album={album} detail={detail} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <h2 id={id} className={styles.heading}>
        {title}
      </h2>
      {children}
    </section>
  );
}
