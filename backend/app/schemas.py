"""Response shapes shared by several routers (library, playlists, home, search, me)."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class Page[T](BaseModel):
    items: list[T]
    total: int
    limit: int
    offset: int


class ArtistRef(BaseModel):
    id: uuid.UUID
    name: str


class AlbumRef(BaseModel):
    id: uuid.UUID
    title: str
    cover_id: uuid.UUID | None
    cover_color: str | None


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
    cover_color: str | None
    added_at: datetime


class AlbumDetail(AlbumOut):
    duration_ms: int
    tracks: list[TrackOut]


class ArtistOut(BaseModel):
    id: uuid.UUID
    name: str
    cover_id: uuid.UUID | None
    album_count: int


class ArtistDetail(ArtistOut):
    albums: list[AlbumOut]
    top_tracks: list[TrackOut]
