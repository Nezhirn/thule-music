from datetime import timedelta

from fastapi import APIRouter, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import RefreshToken, Role, User
from app.auth.schemas import Credentials, RefreshIn, RegisterIn, TokenPair, UserOut
from app.auth.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    verify_password,
)
from app.config import Settings
from app.db import utcnow
from app.deps import AdminUser, CurrentUser, OptionalUser, SessionDep, SettingsDep
from app.errors import ApiError, ErrorCode

router = APIRouter(prefix="/auth", tags=["auth"])
users_router = APIRouter(prefix="/users", tags=["users"])


async def _issue_tokens(session: AsyncSession, settings: Settings, user: User) -> TokenPair:
    raw, token_hash = new_refresh_token()
    session.add(
        RefreshToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=utcnow() + timedelta(seconds=settings.refresh_token_ttl_seconds),
        )
    )
    await session.commit()
    access = create_access_token(
        user.id, user.role.value, settings.secret_key, settings.access_token_ttl_seconds
    )
    return TokenPair(
        access_token=access, refresh_token=raw, expires_in=settings.access_token_ttl_seconds
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, session: SessionDep, actor: OptionalUser) -> User:
    """The very first user bootstraps the server and becomes admin.
    After that, only admins can create accounts."""
    user_count = await session.scalar(select(func.count()).select_from(User))
    if user_count == 0:
        role = Role.admin
    elif actor is None or actor.role != Role.admin:
        raise ApiError(ErrorCode.registration_closed)
    else:
        role = body.role

    if await session.scalar(select(User.id).where(User.username == body.username)):
        raise ApiError(ErrorCode.username_taken)

    user = User(
        username=body.username,
        display_name=body.display_name,
        password_hash=hash_password(body.password),
        role=role,
    )
    session.add(user)
    await session.commit()
    return user


@router.post("/login", response_model=TokenPair)
async def login(body: Credentials, session: SessionDep, settings: SettingsDep) -> TokenPair:
    user = await session.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(user.password_hash, body.password):
        raise ApiError(ErrorCode.invalid_credentials)
    return await _issue_tokens(session, settings, user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshIn, session: SessionDep, settings: SettingsDep) -> TokenPair:
    """Rotates the refresh token. Presenting an already-rotated token is treated as
    theft: every session of that user is revoked."""
    token = await session.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(body.refresh_token))
        .with_for_update()
    )
    if token is None:
        raise ApiError(ErrorCode.invalid_refresh_token)

    now = utcnow()
    if token.revoked_at is not None:
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.user_id == token.user_id, RefreshToken.revoked_at.is_(None))
            .values(revoked_at=now)
        )
        await session.commit()
        raise ApiError(ErrorCode.refresh_token_reused)
    if token.expires_at <= now:
        raise ApiError(ErrorCode.refresh_token_expired)

    user = await session.get(User, token.user_id)
    if user is None:
        raise ApiError(ErrorCode.invalid_refresh_token)
    token.revoked_at = now
    return await _issue_tokens(session, settings, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: RefreshIn, session: SessionDep) -> None:
    await session.execute(
        update(RefreshToken)
        .where(
            RefreshToken.token_hash == hash_refresh_token(body.refresh_token),
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=utcnow())
    )
    await session.commit()


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user


@users_router.get("", response_model=list[UserOut])
async def list_users(session: SessionDep, _: AdminUser) -> list[User]:
    return list(await session.scalars(select(User).order_by(User.created_at)))


@users_router.delete("/{username}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(username: str, session: SessionDep, admin: AdminUser) -> None:
    user = await session.scalar(select(User).where(User.username == username))
    if user is None:
        raise ApiError(ErrorCode.user_not_found)
    if user.id == admin.id:
        raise ApiError(ErrorCode.cannot_delete_self)
    await session.delete(user)
    await session.commit()
