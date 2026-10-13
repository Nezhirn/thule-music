import { useQuery } from "@tanstack/react-query";
import { Shuffle } from "lucide-react";
import { Link, useParams } from "react-router";
import { AlbumCard } from "../catalog/AlbumCard";
import { Cover } from "../catalog/Cover";
import { DetailHeader } from "../catalog/DetailHeader";
import { PageFailed, PageLoading } from "../catalog/PageStatus";
import { albumQuery, artistQuery, type Album } from "../catalog/queries";
import { Shelf } from "../catalog/Shelf";
import { TrackTable } from "../catalog/TrackTable";
import { useI18n } from "../i18n";
import { FavouriteButton } from "../likes/LikeButton";
import { usePlayerControls } from "../player/context";
import { PlayButton } from "../player/PlayButton";
import { CollectionActions } from "../player/TrackActions";
import { IconButton } from "../ui/IconButton";
import styles from "./CatalogPage.module.css";

export function AlbumPage() {
  const { t } = useI18n();
  const { id = "" } = useParams();
  const query = useQuery(albumQuery(id));
  const player = usePlayerControls();
  if (query.isPending) return <PageLoading />;
  if (query.isError) {
    return (
      <PageFailed
        error={query.error}
        notFound={t.errors.album_not_found}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const album = query.data;
  const trackArtists = new Set(album.tracks.map((track) => track.artist.id));
  const compilation = trackArtists.size > 1 && !trackArtists.has(album.artist.id);
  const source = { type: "album", id: album.id } as const;
  return (
    <>
      <DetailHeader
        kind={compilation ? t.catalog.compilation : t.catalog.album}
        title={album.title}
        palette={album.cover_palette}
        art={<Cover id={album.cover_id} sizes="(max-width: 899px) 64vw, 232px" />}
        actions={
          <>
            {album.tracks.length > 0 && (
              <>
                <PlayButton source={source} name={album.title} tracks={() => album.tracks} />
                <IconButton
                  icon={Shuffle}
                  label={t.player.shuffleItem(album.title)}
                  onClick={() => player.play(album.tracks, { shuffle: true, source })}
                />
              </>
            )}
            <FavouriteButton kind="album" item={album} name={album.title} />
            <CollectionActions name={album.title} tracks={album.tracks} />
          </>
        }
      >
        <Link to={`/artists/${album.artist.id}`}>{album.artist.name}</Link>
        {album.year && <span>{album.year}</span>}
        {album.genre && (
          <Link to={`/albums?genre=${encodeURIComponent(album.genre)}`}>{album.genre}</Link>
        )}
        <span>
          {t.catalog.tracks(album.tracks.length)}, {t.catalog.length(album.duration_ms)}
        </span>
      </DetailHeader>
      <TrackTable
        tracks={album.tracks}
        label={album.title}
        source={source}
        numbers="track"
        albumArtistId={album.artist.id}
        byDisc
      />
      {!compilation && <MoreBy album={album} />}
    </>
  );
}

/** The artist's other albums. */
function MoreBy({ album }: { album: Album }) {
  const { t } = useI18n();
  const artist = useQuery(artistQuery(album.artist.id));
  const others = artist.data?.albums.filter((other) => other.id !== album.id) ?? [];
  if (others.length === 0) return null;
  return (
    <div className={styles.after}>
      <Shelf title={t.catalog.moreBy(album.artist.name)} more={`/artists/${album.artist.id}`}>
        {others.map((other) => (
          <AlbumCard key={other.id} album={other} detail="year" />
        ))}
      </Shelf>
    </div>
  );
}
