import time
import uuid
from collections.abc import AsyncIterator
from typing import Annotated

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import Role, User
from app.auth.security import decode_access_token
from app.config import Settings
from app.errors import ApiError, ErrorCode

_bearer = HTTPBearer(auto_error=False)


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    async with request.app.state.sessionmaker() as session:
        yield session


SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
# Closed when the endpoint is done, before the response is sent: a file streamed to a slow
# listener must not hold a connection of the pool (and a transaction) for minutes.
SessionDep = Annotated[AsyncSession, Depends(get_session, scope="function")]


def _unauthorized(code: ErrorCode, detail: str | None = None) -> ApiError:
    return ApiError(code, detail, headers={"WWW-Authenticate": "Bearer"})


# A request may take this long and still count its token as valid when it started.
MAX_REQUEST_AGE_SECONDS = 6 * 3600


def request_age(request: Request) -> float:
    """Seconds since the request came in (see RequestClock)."""
    started = getattr(request.state, "started_at", None)
    return min(max(time.time() - started, 0), MAX_REQUEST_AGE_SECONDS) if started else 0


async def get_optional_user(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User | None:
    if creds is None:
        return None
    try:
        # Valid when the request came in is enough: an upload's body is all read before the
        # token is looked at, and a big file may take longer than the token lives.
        payload = decode_access_token(
            creds.credentials, settings.secret_key, leeway=request_age(request)
        )
        user_id = uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, ValueError) as exc:
        raise _unauthorized(ErrorCode.invalid_token) from exc
    user = await session.get(User, user_id)
    if user is None:
        raise _unauthorized(ErrorCode.invalid_token, "User no longer exists")
    return user


async def get_current_user(user: Annotated[User | None, Depends(get_optional_user)]) -> User:
    if user is None:
        raise _unauthorized(ErrorCode.not_authenticated)
    return user


async def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != Role.admin:
        raise ApiError(ErrorCode.admin_only)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
AdminUser = Annotated[User, Depends(require_admin)]
