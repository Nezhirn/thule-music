import base64
import hashlib
import hmac
import secrets
import uuid
from datetime import timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

from app.db import utcnow

_hasher = PasswordHasher()
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def create_access_token(user_id: uuid.UUID, role: str, secret: str, ttl_seconds: int) -> str:
    now = utcnow()
    payload = {
        "sub": str(user_id),
        "role": role,
        "typ": "access",
        "iat": now,
        "exp": now + timedelta(seconds=ttl_seconds),
    }
    return jwt.encode(payload, secret, algorithm=ALGORITHM)


def decode_access_token(token: str, secret: str, leeway: float = 0) -> dict:
    """Raises jwt.PyJWTError on invalid/expired tokens (expired more than `leeway` seconds
    ago)."""
    payload = jwt.decode(
        token,
        secret,
        algorithms=[ALGORITHM],
        options={"require": ["exp", "sub"]},
        leeway=leeway,
    )
    if payload.get("typ") != "access":
        raise jwt.InvalidTokenError("not an access token")
    return payload


def new_refresh_token() -> tuple[str, str]:
    """Returns (raw token for the client, sha256 hash for storage)."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_refresh_token(raw)


def successor_refresh_token(secret: str, raw: str) -> tuple[str, str]:
    """What a refresh token is exchanged for (raw, hash): derived from it with the server's
    secret, so presenting it again (the answer to the exchange lost) gets the same one."""
    digest = hmac.new(secret.encode(), b"refresh-successor:" + raw.encode(), hashlib.sha256)
    successor = base64.urlsafe_b64encode(digest.digest()).decode().rstrip("=")
    return successor, hash_refresh_token(successor)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
