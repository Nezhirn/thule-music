"""Base of API bodies, and response shapes shared by several routers (library, playlists,
home, search, me)."""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ApiModel(BaseModel):
    """Base of request and response bodies. A field with a default is always present in a
    response, so the OpenAPI schema lists it as required there and generated clients don't
    make it optional; in requests it stays optional."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


class Page[T](ApiModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class CoverPalette(ApiModel):
    """Colours of a cover, for tinting the UI after it (#rrggbb)."""

    average: str
    dominant: str
    # Calm colour for backgrounds and glass.
    muted: str
    # Most vivid colour; None when the cover is essentially greyscale.
    vibrant: str | None
    # WCAG relative luminance of the average colour, 0 (black) to 1 (white).
    luminance: float


class ArtistRef(ApiModel):
    id: uuid.UUID
    name: str


class AlbumRef(ApiModel):
    id: uuid.UUID
    title: str
    cover_id: uuid.UUID | None
    cover_palette: CoverPalette | None


class TrackOut(ApiModel):
    id: uuid.UUID
    title: str
    duration_ms: int
    track_no: int | None
    disc_no: int | None
    codec: str
    bitrate: int | None
    # The main artist.
    artist: ArtistRef
    # Everyone credited ("A feat. B"), the main artist first.
    artists: list[ArtistRef]
    album: AlbumRef
    album_artist: ArtistRef
    # The track's picture: its own if an admin set one, else its album's cover.
    cover_id: uuid.UUID | None
    cover_palette: CoverPalette | None
    liked: bool = False


class AlbumOut(ApiModel):
    id: uuid.UUID
    title: str
    year: int | None
    genre: str | None
    artist: ArtistRef
    cover_id: uuid.UUID | None
    cover_palette: CoverPalette | None
    added_at: datetime
    liked: bool = False


class AlbumDetail(AlbumOut):
    duration_ms: int
    # An admin chose the cover; otherwise it comes from the album's files.
    cover_custom: bool = False
    tracks: list[TrackOut]


class GenreOut(ApiModel):
    name: str
    album_count: int


class ArtistOut(ApiModel):
    id: uuid.UUID
    name: str
    cover_id: uuid.UUID | None
    cover_palette: CoverPalette | None
    album_count: int
    liked: bool = False


class ArtistDetail(ArtistOut):
    albums: list[AlbumOut]
    # Other artists' albums with tracks crediting this one: compilations, features.
    appears_on: list[AlbumOut]
    top_tracks: list[TrackOut]
