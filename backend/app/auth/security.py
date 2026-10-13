import hashlib
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


def decode_access_token(token: str, secret: str) -> dict:
    """Raises jwt.PyJWTError on invalid/expired tokens."""
    payload = jwt.decode(token, secret, algorithms=[ALGORITHM], options={"require": ["exp", "sub"]})
    if payload.get("typ") != "access":
        raise jwt.InvalidTokenError("not an access token")
    return payload


def new_refresh_token() -> tuple[str, str]:
    """Returns (raw token for the client, sha256 hash for storage)."""
    raw = secrets.token_urlsafe(32)
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()
