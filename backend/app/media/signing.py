"""Short-lived signed stream URLs, so `<audio src>` and ExoPlayer can play without headers."""

import base64
import hashlib
import hmac
import time
import uuid


def _digest(secret: str, track_id: uuid.UUID, quality: str, expires: int) -> str:
    msg = f"stream:{track_id}:{quality}:{expires}".encode()
    mac = hmac.new(secret.encode(), msg, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(mac[:24]).decode().rstrip("=")


def sign(secret: str, track_id: uuid.UUID, quality: str, ttl_seconds: int) -> tuple[int, str]:
    expires = int(time.time()) + ttl_seconds
    return expires, _digest(secret, track_id, quality, expires)


def verify(secret: str, track_id: uuid.UUID, quality: str, expires: int, sig: str) -> bool:
    if expires < time.time():
        return False
    # Bytes: compare_digest refuses str with non-ASCII characters, which a URL may carry.
    return hmac.compare_digest(_digest(secret, track_id, quality, expires).encode(), sig.encode())
