import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { api } from "../api/client";
import { unwrap } from "../api/errors";
import { ArtistImage } from "../catalog/ArtistImage";
import { Cover } from "../catalog/Cover";
import { genresQuery, type Album } from "../catalog/queries";
import { useI18n } from "../i18n";
import { TextField } from "../ui/TextField";
import styles from "./edits.module.css";

const NEW = "new";

/** Checkboxes: all the albums, and each. */
export function AlbumChecklist({
  albums,
  selected,
  onChange,
}: {
  albums: Album[];
  selected: Set<string>;
  onChange(selected: Set<string>): void;
}) {
  const { t } = useI18n();
  const text = t.edits.moveAlbumsDialog;
  const all = selected.size === albums.length;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    onChange(next);
  };
  return (
    <fieldset className={styles.choices}>
      <legend className={styles.legend}>{text.which}</legend>
      <label className={`${styles.choice} ${styles.all}`}>
        <input
          type="checkbox"
          checked={all}
          ref={(input) => {
            if (input) input.indeterminate = selected.size > 0 && !all;
          }}
          onChange={() => onChange(new Set(all ? [] : albums.map((album) => album.id)))}
        />
        {text.all}
      </label>
      <div className={styles.scroll}>
        {albums.map((album) => (
          <label key={album.id} className={styles.choice}>
            <input
              type="checkbox"
              checked={selected.has(album.id)}
              onChange={() => toggle(album.id)}
            />
            <Cover id={album.cover_id} sizes="40px" className={styles.thumb} />
            <span className={styles.name}>
              {album.title}
              <span className={styles.by}>
                {album.artist.name}
                {album.year && ` · ${album.year}`}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** An artist of the library found by name, or (with `allowNew`) a new one. Tells the name
 * chosen, or null while there is none. */
export function ArtistPicker({
  legend,
  exclude,
  allowNew = false,
  onChange,
}: {
  legend: string;
  /** The artist things are taken from: not one to choose. */
  exclude: string;
  allowNew?: boolean;
  onChange(name: string | null): void;
}) {
  const { t } = useI18n();
  const text = t.edits.pick;
  const group = useId();
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 250);
    return () => clearTimeout(timer);
  }, [typed]);
  const found = useQuery({
    queryKey: ["artists", "named", q],
    queryFn: () => unwrap(api.GET("/api/v1/artists", { params: { query: { q, limit: 20 } } })),
    enabled: Boolean(q),
    placeholderData: keepPreviousData,
  });
  const artists = q ? (found.data?.items.filter((artist) => artist.id !== exclude) ?? []) : [];

  const choose = (key: string, name: string | null) => {
    setChosen(key);
    onChange(name);
  };

  return (
    <fieldset className={styles.choices}>
      <legend className={styles.legend}>{legend}</legend>
      <TextField
        label={text.findArtist}
        type="search"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
      />
      <div className={styles.scroll} role="radiogroup" aria-label={legend}>
        {artists.map((artist) => (
          <label key={artist.id} className={styles.choice}>
            <input
              type="radio"
              name={group}
              checked={chosen === artist.id}
              onChange={() => choose(artist.id, artist.name)}
            />
            <ArtistImage
              name={artist.name}
              coverId={artist.cover_id}
              sizes="40px"
              className={styles.thumb}
            />
            <span className={styles.name}>
              {artist.name}
              <span className={styles.by}>{t.catalog.albums(artist.album_count)}</span>
            </span>
          </label>
        ))}
        {(!q || artists.length === 0) && (
          <p className={styles.hint}>{q ? text.noArtists : text.typeToFind}</p>
        )}
      </div>
      {allowNew && (
        <>
          <label className={`${styles.choice} ${styles.all}`}>
            <input
              type="radio"
              name={group}
              checked={chosen === NEW}
              onChange={() => choose(NEW, newName.trim() || null)}
            />
            {text.newArtist}
          </label>
          {chosen === NEW && (
            <TextField
              label={text.newArtistName}
              value={newName}
              maxLength={512}
              required
              autoFocus
              onChange={(event) => {
                setNewName(event.target.value);
                onChange(event.target.value.trim() || null);
              }}
            />
          )}
        </>
      )}
    </fieldset>
  );
}

/** A genre of the library, or a new one. Tells the name chosen, or null while there is
 * none. */
export function GenrePicker({
  exclude,
  onChange,
}: {
  /** The genre things are taken from: not one to choose. */
  exclude: string;
  onChange(name: string | null): void;
}) {
  const { t } = useI18n();
  const text = t.edits.pick;
  const group = useId();
  const genres = useQuery(genresQuery);
  const [chosen, setChosen] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const others = (genres.data ?? []).filter(
    (genre) => genre.name.toLowerCase() !== exclude.toLowerCase(),
  );

  const choose = (key: string, name: string | null) => {
    setChosen(key);
    onChange(name);
  };

  return (
    <fieldset className={styles.choices}>
      <legend className={styles.legend}>{text.toGenre}</legend>
      <div className={styles.scroll} role="radiogroup" aria-label={text.toGenre}>
        {others.map((genre) => (
          <label key={genre.name} className={styles.choice}>
            <input
              type="radio"
              name={group}
              checked={chosen === `genre:${genre.name}`}
              onChange={() => choose(`genre:${genre.name}`, genre.name)}
            />
            <span className={styles.name}>
              {genre.name}
              <span className={styles.by}>{t.catalog.albums(genre.album_count)}</span>
            </span>
          </label>
        ))}
        {genres.data && others.length === 0 && <p className={styles.hint}>{text.noGenres}</p>}
      </div>
      <label className={`${styles.choice} ${styles.all}`}>
        <input
          type="radio"
          name={group}
          checked={chosen === NEW}
          onChange={() => choose(NEW, newName.trim() || null)}
        />
        {text.newGenre}
      </label>
      {chosen === NEW && (
        <TextField
          label={text.newGenreName}
          value={newName}
          maxLength={128}
          required
          autoFocus
          onChange={(event) => {
            setNewName(event.target.value);
            onChange(event.target.value.trim() || null);
          }}
        />
      )}
    </fieldset>
  );
}
