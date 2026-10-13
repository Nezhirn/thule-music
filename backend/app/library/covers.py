"""Stores cover art once per unique image, pre-renders square thumbnails and extracts the
colour palette clients use to tint the UI after the current cover."""

import asyncio
import hashlib
import io
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError
from PIL.Image import DecompressionBombError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.jobs.context import JobContext
from app.library.models import Cover

COVER_SIZES = (64, 300, 600)
# Of a cover an admin uploads: scans of album art can be large.
MAX_COVER_BYTES = 20 * 1024 * 1024

# Taken shared by store_cover, exclusively by housekeeping before it deletes unused covers,
# so it can't delete one that an import is about to reference.
COVERS_LOCK = 0x636F_7672  # "covr"

RGB = tuple[int, int, int]
# Below this chroma a colour reads as grey.
VIVID_CHROMA = 0.25
# Swatches smaller than this share of the image are specks, not the cover's colour.
MIN_VIBRANT_SHARE = 0.02


def cover_file(covers_path: Path, cover: Cover, size: int | None) -> Path:
    prefix = cover.source_hash[:2]
    name = f"{cover.source_hash}.jpg" if size is None else f"{cover.source_hash}_{size}.jpg"
    return covers_path / prefix / name


def _hex(rgb: RGB) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def _luminance(rgb: RGB) -> float:
    """WCAG relative luminance: 0 is black, 1 is white."""

    def linear(channel: int) -> float:
        c = channel / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (linear(c) for c in rgb)
    return round(0.2126 * r + 0.7152 * g + 0.0722 * b, 4)


def _chroma(rgb: RGB) -> float:
    return (max(rgb) - min(rgb)) / 255


def _lightness(rgb: RGB) -> float:
    return (max(rgb) + min(rgb)) / 510


def palette_from_color(color: str) -> dict[str, Any]:
    """A palette from the average colour alone (covers stored before palettes existed)."""
    rgb = (int(color[1:3], 16), int(color[3:5], 16), int(color[5:7], 16))
    return {
        "average": color,
        "dominant": color,
        "muted": color,
        "vibrant": color if _chroma(rgb) >= VIVID_CHROMA else None,
        "luminance": _luminance(rgb),
    }


def compute_palette(image: Image.Image) -> dict[str, Any]:
    """average: the mean colour; dominant: the most common one; muted: the most common calm
    one, for backgrounds; vibrant: the most vivid one, or None for an essentially grey cover;
    luminance: of the average, to pick light or dark text over it."""
    average: RGB = image.resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))  # type: ignore[assignment]
    small = image.copy()
    small.thumbnail((64, 64))
    quantized = small.quantize(colors=8, method=Image.Quantize.MEDIANCUT)
    flat = quantized.getpalette() or []
    total = small.width * small.height
    swatches: list[tuple[float, RGB]] = []
    for count, index in quantized.getcolors() or []:
        i = 3 * int(index)  # type: ignore[arg-type]  # a palette image has int pixels
        swatches.append((count / total, (flat[i], flat[i + 1], flat[i + 2])))
    swatches.sort(reverse=True)
    dominant = swatches[0][1] if swatches else average
    vivid = [s for s in swatches if s[0] >= MIN_VIBRANT_SHARE and _chroma(s[1]) >= VIVID_CHROMA]
    # Mostly by vividness, but a large area beats a slightly more vivid speck.
    vibrant = max(vivid, key=lambda s: _chroma(s[1]) * s[0] ** 0.25, default=None)
    calm = [
        rgb for _, rgb in swatches if _chroma(rgb) < VIVID_CHROMA and 0.1 <= _lightness(rgb) <= 0.9
    ]
    return {
        "average": _hex(average),
        "dominant": _hex(dominant),
        "muted": _hex(calm[0] if calm else dominant),
        "vibrant": _hex(vibrant[1]) if vibrant else None,
        "luminance": _luminance(average),
    }


def is_image(data: bytes) -> bool:
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
    except (UnidentifiedImageError, DecompressionBombError, OSError, SyntaxError):
        return False
    return True


def _render(data: bytes, covers_path: Path, source_hash: str) -> tuple[int, int, dict[str, Any]]:
    with Image.open(io.BytesIO(data)) as raw:
        image = ImageOps.exif_transpose(raw).convert("RGB")
    out_dir = covers_path / source_hash[:2]
    out_dir.mkdir(parents=True, exist_ok=True)
    image.save(out_dir / f"{source_hash}.jpg", "JPEG", quality=92)
    for size in COVER_SIZES:
        thumb = ImageOps.fit(image, (size, size), Image.Resampling.LANCZOS)
        thumb.save(out_dir / f"{source_hash}_{size}.jpg", "JPEG", quality=85, optimize=True)
    return image.width, image.height, compute_palette(image)


async def store_cover(session: AsyncSession, covers_path: Path, data: bytes) -> Cover | None:
    """Returns the Cover for these image bytes, creating it if new. None if not an image."""
    await session.execute(select(func.pg_advisory_xact_lock_shared(COVERS_LOCK)))
    source_hash = hashlib.sha256(data).hexdigest()
    existing = await session.scalar(select(Cover).where(Cover.source_hash == source_hash))
    if existing is not None:
        return existing
    try:
        width, height, palette = await asyncio.to_thread(_render, data, covers_path, source_hash)
    except (UnidentifiedImageError, DecompressionBombError, OSError):
        return None
    cover = Cover(
        source_hash=source_hash,
        width=width,
        height=height,
        color=palette["average"],
        palette=palette,
    )
    session.add(cover)
    await session.flush()
    return cover


def _palette_from_file(path: Path, color: str) -> dict[str, Any]:
    try:
        with Image.open(path) as image:
            return compute_palette(image.convert("RGB"))
    except (UnidentifiedImageError, DecompressionBombError, OSError):
        return palette_from_color(color)


async def backfill_palettes(ctx: JobContext, payload: dict[str, Any]) -> None:
    """Computes palettes for covers stored before they existed (job `cover_palettes`)."""
    while True:
        async with ctx.sessionmaker() as session:
            covers = (
                await session.scalars(select(Cover).where(Cover.palette.is_(None)).limit(200))
            ).all()
            if not covers:
                return
            for cover in covers:
                path = cover_file(ctx.settings.covers_path, cover, 300)
                cover.palette = await asyncio.to_thread(_palette_from_file, path, cover.color)
            await session.commit()
