"""Imports every model so Base.metadata is complete (Alembic, tests)."""

from app.auth.models import LoginFailure, RefreshToken, User
from app.db import Base
from app.jobs.models import Job
from app.library.models import Album, Artist, Cover, Track, TrackArtist, TrackFile
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
    "LoginFailure",
    "Lyrics",
    "PlayEvent",
    "Playlist",
    "PlaylistItem",
    "RefreshToken",
    "Track",
    "TrackArtist",
    "TrackFile",
    "TrackLike",
    "User",
]
