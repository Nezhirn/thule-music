"""indexes for foreign keys and jobs

Deleting a track, album, artist or cover deletes (or clears) the rows referring to it, one
statement per row deleted: without an index on the referring column, each reads that whole
table. The artist page counts plays per track, and the job queue and the admin page look jobs
up by kind and by when their worker was last heard of.

Built CONCURRENTLY: on a large database a plain CREATE INDEX would lock the table against
writes (plays, likes, imports) for as long as it takes.

Revision ID: 5e0c7a1b9d24
Revises: 950d1c9a71ab
Create Date: 2026-10-14 08:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "5e0c7a1b9d24"
down_revision: str | None = "950d1c9a71ab"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# name, table, columns, partial condition
INDEXES: list[tuple[str, str, list[str], str | None]] = [
    ("ix_play_events_track_id", "play_events", ["track_id"], None),
    ("ix_playlist_items_track_id", "playlist_items", ["track_id"], None),
    ("ix_track_likes_track_id", "track_likes", ["track_id"], None),
    ("ix_album_likes_album_id", "album_likes", ["album_id"], None),
    ("ix_artist_likes_artist_id", "artist_likes", ["artist_id"], None),
    ("ix_albums_cover_id", "albums", ["cover_id"], "cover_id IS NOT NULL"),
    ("ix_tracks_cover_id", "tracks", ["cover_id"], "cover_id IS NOT NULL"),
    ("ix_artists_cover_id", "artists", ["cover_id"], "cover_id IS NOT NULL"),
    ("ix_users_avatar_id", "users", ["avatar_id"], "avatar_id IS NOT NULL"),
    ("ix_jobs_kind_created_at", "jobs", ["kind", "created_at"], None),
    ("ix_jobs_running_locked_at", "jobs", ["locked_at"], "status = 'running'"),
]


def upgrade() -> None:
    with op.get_context().autocommit_block():
        # Building CONCURRENTLY blocks no one, but waits for transactions in progress to
        # end: not limited like the locks of other changes (see env.py).
        op.execute("SET lock_timeout = 0")
        for name, table, columns, where in INDEXES:
            # A build cut short leaves an invalid index of that name: made again.
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_invalid(name)}")
            op.create_index(
                name,
                table,
                columns,
                postgresql_concurrently=True,
                postgresql_where=sa.text(where) if where else None,
                if_not_exists=True,
            )
        op.execute("SET lock_timeout = '10s'")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _, _, _ in reversed(INDEXES):
            op.drop_index(name, postgresql_concurrently=True, if_exists=True)


def _invalid(name: str) -> str:
    """The index's name if it exists but is invalid (a CONCURRENTLY build that failed),
    else a name that doesn't exist."""
    connection = op.get_bind()
    invalid = connection.execute(
        sa.text(
            "SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE c.relname = :name AND n.nspname = current_schema() AND NOT i.indisvalid"
        ),
        {"name": name},
    ).scalar()
    return name if invalid else f"{name}_not_there"
