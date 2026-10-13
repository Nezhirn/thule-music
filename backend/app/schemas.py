"""Response shapes shared by several routers (library, playlists, home, search, me)."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class CoverPalette(BaseModel):
    """Colours of a cover, for tinting the UI after it (#rrggbb)."""

    average: str
    dominant: str
    # Calm colour for backgrounds and glass.
    muted: str
    # Most vivid colour; None when the cover is essentially greyscale.
    vibrant: str | None
    # WCAG relative luminance of the average colour, 0 (black) to 1 (white).
    luminance: float


class ArtistRef(BaseModel):
    id: uuid.UUID
    name: str


class AlbumRef(BaseModel):
    id: uuid.UUID
    title: str
    cover_id: uuid.UUID | None
    cover_palette: CoverPalette | None


class TrackOut(BaseModel):
    id: uuid.UUID
    title: str
    duration_ms: int
    track_no: int | None
    disc_no: int | None
    codec: str
    bitrate: int | None
    artist: ArtistRef
    album: AlbumRef
    album_artist: ArtistRef
    liked: bool = False


class AlbumOut(BaseModel):
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
    tracks: list[TrackOut]


class ArtistOut(BaseModel):
    id: uuid.UUID
    name: str
    cover_id: uuid.UUID | None
    cover_palette: CoverPalette | None
    album_count: int
    liked: bool = False


class ArtistDetail(ArtistOut):
    albums: list[AlbumOut]
    top_tracks: list[TrackOut]
