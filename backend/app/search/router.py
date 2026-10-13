from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, or_, select

from app.deps import CurrentUser, SessionDep
from app.library.models import Album, Artist, Track
from app.library.queries import (
    ALBUM_LOAD,
    albums_out,
    artists_out,
    contains,
    track_select,
    tracks_out,
)
from app.schemas import AlbumOut, ApiModel, ArtistOut, TrackOut

router = APIRouter(tags=["search"])

# pg_trgm word_similarity threshold for typo-tolerant matches ("katatonya" -> "Katatonia").
FUZZY_THRESHOLD = 0.4


class SearchOut(ApiModel):
    artists: list[ArtistOut]
    albums: list[AlbumOut]
    tracks: list[TrackOut]


def _match(column, q: str):
    """Substring match or fuzzy trigram match; ranked by similarity."""
    return (
        or_(
            column.ilike(contains(q), escape="\\"),
            func.word_similarity(q, column) >= FUZZY_THRESHOLD,
        ),
        func.word_similarity(q, column).desc(),
    )


@router.get("/search", response_model=SearchOut)
async def search(
    session: SessionDep,
    user: CurrentUser,
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
) -> SearchOut:
    q = q.strip()
    where, rank = _match(Artist.name, q)
    artists = (
        await session.scalars(
            select(Artist).where(where).order_by(rank, Artist.name_key).limit(limit)
        )
    ).all()

    where, rank = _match(Album.title, q)
    albums = (
        await session.scalars(
            select(Album)
            .where(where)
            .options(*ALBUM_LOAD)
            .order_by(rank, Album.title_key)
            .limit(limit)
        )
    ).all()

    # Tracks match on title, or on artist name ("katatonia" lists their tracks too).
    title_where, title_rank = _match(Track.title, q)
    artist_where, artist_rank = _match(Artist.name, q)
    tracks = (
        await session.scalars(
            track_select()
            .join(Artist, Artist.id == Track.artist_id)
            .where(or_(title_where, artist_where))
            .order_by(
                func.greatest(
                    func.word_similarity(q, Track.title), func.word_similarity(q, Artist.name)
                ).desc(),
                Track.title,
            )
            .limit(limit)
        )
    ).all()

    return SearchOut(
        artists=await artists_out(session, user.id, artists),
        albums=await albums_out(session, user.id, albums),
        tracks=await tracks_out(session, user.id, tracks),
    )
