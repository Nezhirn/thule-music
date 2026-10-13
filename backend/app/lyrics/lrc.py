"""Minimal LRC parser: `[mm:ss.xx]text`, several stamps per line, `[offset:±ms]`,
metadata tags and enhanced `<mm:ss.xx>` word stamps (stripped)."""

import re
from dataclasses import dataclass

_STAMP = re.compile(r"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]")
_WORD_STAMP = re.compile(r"<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>")
_OFFSET = re.compile(r"^\[offset:\s*([+-]?\d+)\s*\]", re.IGNORECASE | re.MULTILINE)


@dataclass(frozen=True)
class LrcLine:
    time_ms: int
    text: str


def _to_ms(minutes: str, seconds: str, fraction: str | None) -> int:
    frac_ms = 0
    if fraction:
        # ".5" -> 500, ".05" -> 50, ".005" -> 5
        frac_ms = int(fraction.ljust(3, "0")[:3])
    return (int(minutes) * 60 + int(seconds)) * 1000 + frac_ms


def is_synced(text: str) -> bool:
    return any(_STAMP.match(line.strip()) for line in text.splitlines())


def parse_lrc(text: str) -> list[LrcLine]:
    offset_match = _OFFSET.search(text)
    # Positive offset means lyrics appear sooner.
    offset = int(offset_match.group(1)) if offset_match else 0

    lines: list[LrcLine] = []
    for raw in text.splitlines():
        raw = raw.strip()
        stamps: list[int] = []
        pos = 0
        while match := _STAMP.match(raw, pos):
            stamps.append(_to_ms(*match.groups()))
            pos = match.end()
        if not stamps:
            continue
        body = _WORD_STAMP.sub("", raw[pos:]).strip()
        lines.extend(LrcLine(max(0, t - offset), body) for t in stamps)
    lines.sort(key=lambda line: line.time_ms)
    return lines


def to_plain(text: str) -> str:
    """LRC -> plain text (timestamps and metadata removed)."""
    if not is_synced(text):
        return text.strip()
    return "\n".join(line.text for line in parse_lrc(text)).strip()
