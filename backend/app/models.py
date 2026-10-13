"""Imports every model so Base.metadata is complete (Alembic, tests)."""

from app.auth.models import RefreshToken, User
from app.db import Base
from app.jobs.models import Job
from app.library.models import Album, Artist, Cover, Track, TrackFile
from app.lyrics.models import Lyrics
from app.me.models import AlbumLike, ArtistLike, PlayEvent, TrackLike
from app.playlists.models import Playlist, PlaylistItem

__all__ = [
    "Album",
    "AlbumLike",
    "ArtistLike",
    "Artist",
    "Base",
    "Cover",
    "Job",
    "Lyrics",
    "PlayEvent",
    "Playlist",
    "PlaylistItem",
    "RefreshToken",
    "Track",
    "TrackFile",
    "TrackLike",
    "User",
]
