"""Finds lyrics for a track: sidecar .lrc/.txt -> embedded tag -> LRCLIB (runs in the worker)."""

import asyncio
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import selectinload

from app.db import utcnow
from app.jobs.context import JobContext
from app.jobs.queue import Postpone
from app.library.importer import resolve_in_library
from app.library.models import Album, Track
from app.library.tags import embedded_lyrics
from app.lyrics.lrc import is_synced, to_plain
from app.lyrics.models import MANUAL, SIDECAR_SUFFIXES, Lyrics

USER_AGENT = "thule-music/0.1 (self-hosted music server)"
# LRCLIB not answering a connection gives up sooner than a slow answer.
TIMEOUT = httpx.Timeout(15, connect=5)


class _Breaker:
    """LRCLIB unreachable, failing or asking to slow down: for a while (5 minutes, doubled up
    to an hour while it stays so) lookups wait instead of each trying and failing, which
    took the worker's turns from imports and transcodes and filled the failed jobs."""

    FIRST = timedelta(minutes=5)
    LONGEST = timedelta(hours=1)

    def __init__(self) -> None:
        self.until: datetime | None = None
        self.pause = self.FIRST

    def check(self) -> None:
        if self.until is not None and utcnow() < self.until:
            raise Postpone(self.until, "LRCLIB is unavailable for now")

    def failed(self, wait: timedelta | None = None) -> None:
        self.until = utcnow() + (wait or self.pause)
        self.pause = min(self.pause * 2, self.LONGEST)

    def worked(self) -> None:
        self.until, self.pause = None, self.FIRST


breaker = _Breaker()


def from_text(text: str, source: str) -> dict[str, Any]:
    synced = text if is_synced(text) else None
    return {
        "synced": synced,
        "plain": to_plain(text) or None,
        "instrumental": False,
        "source": source,
    }


async def _lrclib(ctx: JobContext, track: Track) -> dict[str, Any] | None:
    """Raises Postpone while LRCLIB is unavailable (see _Breaker)."""
    breaker.check()
    params: dict[str, str | int] = {
        "track_name": track.title,
        "artist_name": track.artist.name,
        "album_name": track.album.title,
        "duration": round(track.duration_ms / 1000),
    }
    try:
        resp = await ctx.http.get(
            f"{ctx.settings.lrclib_url.rstrip('/')}/api/get",
            params=params,
            headers={"User-Agent": USER_AGENT},
            timeout=TIMEOUT,
        )
    except httpx.TransportError as exc:
        breaker.failed()
        raise Postpone(breaker.until or utcnow(), f"LRCLIB unreachable: {exc!r}") from exc
    if resp.status_code == 429 or resp.status_code >= 500:
        breaker.failed(_retry_after(resp))
        raise Postpone(breaker.until or utcnow(), f"LRCLIB answered {resp.status_code}")
    breaker.worked()
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


def _retry_after(resp: httpx.Response) -> timedelta | None:
    try:
        seconds = int(resp.headers.get("retry-after", ""))
    except ValueError:
        return None
    return timedelta(seconds=min(max(seconds, 1), 3600))


def _read_embedded(path: Path) -> str | None:
    try:
        return embedded_lyrics(path)
    except Exception:
        return None  # unreadable now: the import reports it


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
        existing = await session.get(Lyrics, track.id)
        if existing is not None and existing.source == MANUAL:
            return

        found: dict[str, Any] | None = None
        audio = resolve_in_library(ctx.settings.library_path, track.path)
        for suffix in SIDECAR_SUFFIXES:
            sidecar = audio.with_suffix(suffix)
            if sidecar.is_file():
                text = await asyncio.to_thread(
                    sidecar.read_text, encoding="utf-8", errors="replace"
                )
                if text.strip():
                    found = from_text(text, "sidecar")
                    break
        if found is None:
            # The import passes what the tags hold; a scan that noticed a lyrics file come or
            # go doesn't read the tags, so they are read here.
            if "embedded" in payload:
                embedded = payload["embedded"]
            else:
                embedded = await asyncio.to_thread(_read_embedded, audio)
            if embedded:
                found = from_text(embedded, "embedded")
        if found is None and ctx.settings.lrclib_enabled:
            # LRCLIB unavailable: the job runs later (Postpone) instead of caching a miss.
            found = await _lrclib(ctx, track)
            if found is None and existing is not None and existing.source == "lrclib":
                # Found once: not lost because a new album name or spelling isn't found.
                return
        if found is None:
            found = {"synced": None, "plain": None, "instrumental": False, "source": "none"}

        values = {**found, "fetched_at": utcnow()}
        await session.execute(
            insert(Lyrics)
            .values(track_id=track.id, **values)
            .on_conflict_do_update(
                index_elements=[Lyrics.track_id],
                set_=values,
                # An admin may have written them meanwhile.
                where=Lyrics.source != MANUAL,
            )
        )
        await session.commit()
