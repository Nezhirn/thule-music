"""Finds lyrics for a track: sidecar .lrc/.txt -> embedded tag -> LRCLIB (runs in the worker)."""

import asyncio
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import selectinload

from app.db import utcnow
from app.jobs.context import JobContext
from app.library.importer import resolve_in_library
from app.library.models import Album, Track
from app.lyrics.lrc import is_synced, to_plain
from app.lyrics.models import Lyrics

USER_AGENT = "thule-music/0.1 (self-hosted music server)"


def _from_text(text: str, source: str) -> dict[str, Any]:
    synced = text if is_synced(text) else None
    return {
        "synced": synced,
        "plain": to_plain(text) or None,
        "instrumental": False,
        "source": source,
    }


async def _lrclib(ctx: JobContext, track: Track) -> dict[str, Any] | None:
    params: dict[str, str | int] = {
        "track_name": track.title,
        "artist_name": track.artist.name,
        "album_name": track.album.title,
        "duration": round(track.duration_ms / 1000),
    }
    resp = await ctx.http.get(
        f"{ctx.settings.lrclib_url.rstrip('/')}/api/get",
        params=params,
        headers={"User-Agent": USER_AGENT},
        timeout=15,
    )
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    data = resp.json()
    if not (data.get("syncedLyrics") or data.get("plainLyrics") or data.get("instrumental")):
        return None
    return {
        "synced": data.get("syncedLyrics") or None,
        "plain": data.get("plainLyrics") or None,
        "instrumental": bool(data.get("instrumental")),
        "source": "lrclib",
    }


async def fetch_lyrics(ctx: JobContext, payload: dict[str, Any]) -> None:
    track_id = uuid.UUID(payload["track_id"])
    async with ctx.sessionmaker() as session:
        track = await session.scalar(
            select(Track)
            .where(Track.id == track_id)
            .options(
                selectinload(Track.artist), selectinload(Track.album).selectinload(Album.artist)
            )
        )
        if track is None:
            return

        found: dict[str, Any] | None = None
        audio = resolve_in_library(ctx.settings.library_path, track.path)
        for suffix in (".lrc", ".txt"):
            sidecar = audio.with_suffix(suffix)
            if sidecar.is_file():
                text = await asyncio.to_thread(
                    sidecar.read_text, encoding="utf-8", errors="replace"
                )
                if text.strip():
                    found = _from_text(text, "sidecar")
                    break
        if found is None and payload.get("embedded"):
            found = _from_text(payload["embedded"], "embedded")
        if found is None and ctx.settings.lrclib_enabled:
            # Network errors propagate so the queue retries instead of caching a miss.
            found = await _lrclib(ctx, track)
        if found is None:
            found = {"synced": None, "plain": None, "instrumental": False, "source": "none"}

        values = {**found, "fetched_at": utcnow()}
        await session.execute(
            insert(Lyrics)
            .values(track_id=track.id, **values)
            .on_conflict_do_update(index_elements=[Lyrics.track_id], set_=values)
        )
        await session.commit()
