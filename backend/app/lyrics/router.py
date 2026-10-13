import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.deps import CurrentUser, SessionDep
from app.lyrics.lrc import parse_lrc
from app.lyrics.models import Lyrics

router = APIRouter(tags=["lyrics"])


class LyricLine(BaseModel):
    time_ms: int
    text: str


class LyricsOut(BaseModel):
    track_id: uuid.UUID
    source: str
    instrumental: bool
    synced: bool
    lines: list[LyricLine]  # timed lines when synced, else empty
    plain: str | None


@router.get("/tracks/{track_id}/lyrics", response_model=LyricsOut)
async def get_lyrics(track_id: uuid.UUID, session: SessionDep, _: CurrentUser) -> LyricsOut:
    lyrics = await session.get(Lyrics, track_id)
    if lyrics is None or lyrics.source == "none":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No lyrics for this track")
    lines = parse_lrc(lyrics.synced) if lyrics.synced else []
    return LyricsOut(
        track_id=track_id,
        source=lyrics.source,
        instrumental=lyrics.instrumental,
        synced=bool(lines),
        lines=[LyricLine(time_ms=line.time_ms, text=line.text) for line in lines],
        plain=lyrics.plain,
    )
