import { Fragment } from "react";
import { Link } from "react-router";
import type { Schemas } from "../api/client";
import styles from "./ArtistLinks.module.css";

/** Artists as links, comma-separated: "Северный Ветер, Анна Лунина". */
export function ArtistLinks({ artists }: { artists: Schemas["ArtistRef"][] }) {
  return artists.map((artist, i) => (
    <Fragment key={artist.id}>
      {i > 0 && ", "}
      <Link to={`/artists/${artist.id}`} className={styles.link}>
        {artist.name}
      </Link>
    </Fragment>
  ));
}
