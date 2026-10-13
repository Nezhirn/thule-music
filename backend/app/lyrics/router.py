import uuid

from fastapi import APIRouter, status
from pydantic import Field
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.db import utcnow
from app.deps import AdminUser, CurrentUser, SessionDep
from app.errors import ApiError, ErrorCode
from app.jobs.queue import enqueue
from app.library.models import Track
from app.lyrics.fetch import from_text
from app.lyrics.lrc import parse_lrc
from app.lyrics.models import MANUAL, Lyrics
from app.schemas import ApiModel

router = APIRouter(tags=["lyrics"])


class LyricLine(ApiModel):
    time_ms: int
    text: str


class LyricsOut(ApiModel):
    track_id: uuid.UUID
    source: str
    instrumental: bool
    synced: bool
    lines: list[LyricLine]  # timed lines when synced, else empty
    plain: str | None


class LyricsIn(ApiModel):
    # The words; LRC with timestamps is taken too. Empty: the track has no lyrics.
    text: str = Field(default="", max_length=100_000)
    # No words to sing: the text is ignored.
    instrumental: bool = False


def _lyrics_out(lyrics: Lyrics | None) -> LyricsOut | None:
    """None when there is nothing to show: not found, or taken away by an admin."""
    if lyrics is None or not (lyrics.plain or lyrics.synced or lyrics.instrumental):
        return None
    lines = parse_lrc(lyrics.synced) if lyrics.synced else []
    return LyricsOut(
        track_id=lyrics.track_id,
        source=lyrics.source,
        instrumental=lyrics.instrumental,
        synced=bool(lines),
        lines=[LyricLine(time_ms=line.time_ms, text=line.text) for line in lines],
        plain=lyrics.plain,
    )


async def _track_exists(session: SessionDep, track_id: uuid.UUID) -> None:
    if await session.scalar(select(Track.id).where(Track.id == track_id)) is None:
        raise ApiError(ErrorCode.track_not_found)


@router.get("/tracks/{track_id}/lyrics", response_model=LyricsOut)
async def get_lyrics(track_id: uuid.UUID, session: SessionDep, _: CurrentUser) -> LyricsOut:
    out = _lyrics_out(await session.get(Lyrics, track_id))
    if out is None:
        raise ApiError(ErrorCode.lyrics_not_found)
    return out


@router.put("/tracks/{track_id}/lyrics", response_model=LyricsOut | None, tags=["admin"])
async def set_lyrics(
    track_id: uuid.UUID, body: LyricsIn, session: SessionDep, _: AdminUser
) -> LyricsOut | None:
    """Admins write a track's lyrics, or take wrong ones away (empty text). They stay
    whatever the files or LRCLIB say, until `DELETE` gives them up. Returns the lyrics as
    `GET` does; null when the track now has none."""
    await _track_exists(session, track_id)
    if body.instrumental:
        found = {"synced": None, "plain": None, "instrumental": True, "source": MANUAL}
    elif body.text.strip():
        found = from_text(body.text, MANUAL)
    else:
        found = {"synced": None, "plain": None, "instrumental": False, "source": MANUAL}
    values = {**found, "fetched_at": utcnow()}
    lyrics = await session.scalar(
        insert(Lyrics)
        .values(track_id=track_id, **values)
        .on_conflict_do_update(index_elements=[Lyrics.track_id], set_=values)
        .returning(Lyrics)
    )
    await session.commit()
    return _lyrics_out(lyrics)


@router.delete("/tracks/{track_id}/lyrics", status_code=status.HTTP_202_ACCEPTED, tags=["admin"])
async def find_lyrics_again(track_id: uuid.UUID, session: SessionDep, _: AdminUser) -> None:
    """Forgets the track's lyrics, an admin's included, and looks for them again as an
    import does (lyrics file, tags, LRCLIB) in the background."""
    await _track_exists(session, track_id)
    await session.execute(delete(Lyrics).where(Lyrics.track_id == track_id))
    # Not the import's key: a lookup already running may have seen the admin's lyrics and
    # kept them.
    await enqueue(
        session,
        "fetch_lyrics",
        {"track_id": str(track_id)},
        dedupe_key=f"lyrics-again:{track_id}",
    )
    await session.commit()
