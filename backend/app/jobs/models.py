import enum
from datetime import datetime
from typing import Any

from sqlalchemy import Enum, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base, UUIDPk, utcnow


class JobStatus(enum.StrEnum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


class Job(UUIDPk, Base):
    __tablename__ = "jobs"

    kind: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus, name="job_status"), default=JobStatus.queued
    )
    # Prevents enqueueing the same pending work twice (e.g. "import:<path>").
    dedupe_key: Mapped[str | None] = mapped_column(String(2048))
    attempts: Mapped[int] = mapped_column(default=0)
    max_attempts: Mapped[int] = mapped_column(default=3)
    error: Mapped[str | None] = mapped_column(Text)
    # What a finished job reports, e.g. a scan's counts of added and removed files.
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    run_after: Mapped[datetime] = mapped_column(default=utcnow)
    locked_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    finished_at: Mapped[datetime | None]

    __table_args__ = (
        Index(
            "ix_jobs_pending",
            "run_after",
            postgresql_where=text("status = 'queued'"),
        ),
        Index(
            "uq_jobs_dedupe_active",
            "dedupe_key",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running') AND dedupe_key IS NOT NULL"),
        ),
    )
