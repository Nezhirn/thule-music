import enum
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, literal, or_, select, union

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


class SearchType(enum.StrEnum):
    artists = "artists"
    albums = "albums"
    tracks = "tracks"


class SearchOut(ApiModel):
    artists: list[ArtistOut]
    albums: list[AlbumOut]
    tracks: list[TrackOut]


def _match(column, q: str):
    """Substring match or fuzzy trigram match, and how close the match is. Both conditions
    are operators the trigram index answers (`q <% column` is word_similarity at least
    FUZZY_THRESHOLD, set for each connection: see app.db), so a search reads the index, not
    the whole table."""
    return (
        or_(column.ilike(contains(q), escape="\\"), literal(q).op("<%")(column)),
        func.word_similarity(q, column),
    )


@router.get("/search", response_model=SearchOut)
async def search(
    session: SessionDep,
    user: CurrentUser,
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    offset: Annotated[int, Query(ge=0)] = 0,
    only: Annotated[SearchType | None, Query(alias="type")] = None,
) -> SearchOut:
    """Artists, albums and tracks matching `q`, closest first; `type` asks for one kind
    only, paged with `limit` and `offset`. Albums and tracks match their artist's name too
    ("katatonia" lists their albums and tracks)."""
    q = q.strip()
    artists: list[Artist] = []
    albums: list[Album] = []
    tracks: list[Track] = []

    if only in (None, SearchType.artists):
        where, similarity = _match(Artist.name, q)
        artists = list(
            await session.scalars(
                select(Artist)
                .where(where)
                .order_by(similarity.desc(), Artist.name_key, Artist.id)
                .limit(limit)
                .offset(offset)
            )
        )

    if only in (None, SearchType.albums):
        title_where, title_similarity = _match(Album.title, q)
        artist_where, artist_similarity = _match(Artist.name, q)
        # By title, or by artist: each found along its own index.
        found = union(
            select(Album.id).where(title_where),
            select(Album.id).where(Album.artist_id.in_(select(Artist.id).where(artist_where))),
        ).subquery()
        albums = list(
            await session.scalars(
                select(Album)
                .join(Artist, Artist.id == Album.artist_id)
                .where(Album.id.in_(select(found.c.id)))
                .options(*ALBUM_LOAD)
                .order_by(
                    func.greatest(title_similarity, artist_similarity).desc(),
                    Album.title_key,
                    Album.id,
                )
                .limit(limit)
                .offset(offset)
            )
        )

    if only in (None, SearchType.tracks):
        title_where, title_similarity = _match(Track.title, q)
        artist_where, artist_similarity = _match(Artist.name, q)
        found = union(
            select(Track.id).where(title_where),
            select(Track.id).where(Track.artist_id.in_(select(Artist.id).where(artist_where))),
        ).subquery()
        tracks = list(
            await session.scalars(
                track_select()
                .join(Artist, Artist.id == Track.artist_id)
                .where(Track.id.in_(select(found.c.id)))
                .order_by(
                    func.greatest(title_similarity, artist_similarity).desc(),
                    Track.title,
                    Track.id,
                )
                .limit(limit)
                .offset(offset)
            )
        )

    return SearchOut(
        artists=await artists_out(session, user.id, artists),
        albums=await albums_out(session, user.id, albums),
        tracks=await tracks_out(session, user.id, tracks),
    )
