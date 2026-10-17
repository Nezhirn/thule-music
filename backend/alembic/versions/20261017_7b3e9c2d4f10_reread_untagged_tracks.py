"""re-read untagged tracks

Files without tags were imported as "Unknown Artist" and "Unknown Album", titled after the
whole file name ("Artist - Title"). Their folders and names are now read for what the tags
leave out: these tracks are marked changed (their mtime cleared), so the next scan imports
them again. Nothing else changes: the scan keeps their ids, likes and plays.

Revision ID: 7b3e9c2d4f10
Revises: 5e0c7a1b9d24
Create Date: 2026-10-17 09:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "7b3e9c2d4f10"
down_revision: str | None = "5e0c7a1b9d24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE tracks SET mtime = 0
        WHERE artist_id IN (SELECT id FROM artists WHERE name_key = 'unknown artist')
           OR album_id IN (
                SELECT albums.id FROM albums JOIN artists ON artists.id = albums.artist_id
                WHERE albums.title_key = 'unknown album' OR artists.name_key = 'unknown artist'
           )
           OR EXISTS (
                SELECT 1 FROM artists
                WHERE artists.id = tracks.artist_id
                  AND left(lower(tracks.title), length(artists.name) + 3)
                      = lower(artists.name) || ' - '
           )
        """
    )


def downgrade() -> None:
    # Nothing to undo: the tracks were imported again from their files.
    pass
