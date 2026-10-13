"""Stores cover art once per unique image and pre-renders square thumbnails."""

import asyncio
import hashlib
import io
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.library.models import Cover

COVER_SIZES = (64, 300, 600)


def cover_file(covers_path: Path, cover: Cover, size: int | None) -> Path:
    prefix = cover.source_hash[:2]
    name = f"{cover.source_hash}.jpg" if size is None else f"{cover.source_hash}_{size}.jpg"
    return covers_path / prefix / name


def _render(data: bytes, covers_path: Path, source_hash: str) -> tuple[int, int, str]:
    with Image.open(io.BytesIO(data)) as raw:
        image = ImageOps.exif_transpose(raw).convert("RGB")
    out_dir = covers_path / source_hash[:2]
    out_dir.mkdir(parents=True, exist_ok=True)
    image.save(out_dir / f"{source_hash}.jpg", "JPEG", quality=92)
    for size in COVER_SIZES:
        thumb = ImageOps.fit(image, (size, size), Image.Resampling.LANCZOS)
        thumb.save(out_dir / f"{source_hash}_{size}.jpg", "JPEG", quality=85, optimize=True)
    r, g, b = image.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))  # type: ignore[misc]
    return image.width, image.height, f"#{r:02x}{g:02x}{b:02x}"


async def store_cover(session: AsyncSession, covers_path: Path, data: bytes) -> Cover | None:
    """Returns the Cover for these image bytes, creating it if new. None if not an image."""
    source_hash = hashlib.sha256(data).hexdigest()
    existing = await session.scalar(select(Cover).where(Cover.source_hash == source_hash))
    if existing is not None:
        return existing
    try:
        width, height, color = await asyncio.to_thread(_render, data, covers_path, source_hash)
    except (UnidentifiedImageError, DecompressionBombError, OSError):
        return None
    cover = Cover(source_hash=source_hash, width=width, height=height, color=color)
    session.add(cover)
    await session.flush()
    return cover
