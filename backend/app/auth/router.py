import math
import uuid
from asyncio import to_thread
from datetime import timedelta

from fastapi import APIRouter, UploadFile, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import LoginFailure, RefreshToken, Role, User
from app.auth.schemas import (
    Credentials,
    PasswordChange,
    PasswordReset,
    ProfilePatch,
    RefreshIn,
    RegisterIn,
    SetupStatus,
    TokenPair,
    UserAdminOut,
    UserOut,
    UserPatch,
)
from app.auth.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    new_refresh_token,
    successor_refresh_token,
    verify_password,
)
from app.config import Settings
from app.db import utcnow
from app.deps import AdminUser, CurrentUser, OptionalUser, SessionDep, SettingsDep
from app.errors import ApiError, ErrorCode
from app.library.covers import store_cover

router = APIRouter(prefix="/auth", tags=["auth"])
users_router = APIRouter(prefix="/users", tags=["users"])

MAX_AVATAR_BYTES = 10 * 1024 * 1024

# Failed logins allowed per username within the window; further attempts get 429 until the
# oldest failure leaves it. Per username, not per IP: behind a reverse proxy every client
# may share the proxy's address, and forwarded addresses can be forged.
MAX_LOGIN_FAILURES = 10
LOGIN_FAILURE_WINDOW = timedelta(minutes=15)

# A rotated refresh token presented again after what it was exchanged for was used, but
# within this time, is a race, not theft: another tab of the same browser that exchanged it
# and refreshed again meanwhile (browsers allow cross-tab locks only over HTTPS). It is
# refused without ending every session; the client picks up the token its other tab stored.
# (Presented again before its successor was used, it just gets that successor again.)
REFRESH_REUSE_GRACE = timedelta(seconds=30)

# Serialises registrations, so two concurrent first sign-ups can't both become admin.
_REGISTER_LOCK = 0x7468_756C  # "thul"


async def _revoke_sessions(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=utcnow())
    )


async def _issue_tokens(
    session: AsyncSession,
    settings: Settings,
    user: User,
    refresh: tuple[str, str] | None = None,
    *,
    stored: bool = False,
) -> TokenPair:
    """A new access token, with the refresh token `refresh` (raw, hash; a new random one
    if None), stored unless it already is."""
    raw, token_hash = refresh or new_refresh_token()
    user.last_seen_at = utcnow()
    if not stored:
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


@router.get("/setup", response_model=SetupStatus)
async def get_setup_status(session: SessionDep) -> SetupStatus:
    """Public. Whether the server still has no accounts (then `register` creates the admin)."""
    has_users = await session.scalar(select(select(User.id).exists()))
    return SetupStatus(needs_setup=not has_users)


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterIn, session: SessionDep, actor: OptionalUser) -> User:
    """The very first user bootstraps the server and becomes admin.
    After that, only admins can create accounts."""
    await session.execute(select(func.pg_advisory_xact_lock(_REGISTER_LOCK)))
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
        password_hash=await to_thread(hash_password, body.password),
        role=role,
    )
    session.add(user)
    await session.commit()
    return user


@router.post("/login", response_model=TokenPair)
async def login(body: Credentials, session: SessionDep, settings: SettingsDep) -> TokenPair:
    """After too many failed attempts for a username, answers 429 with Retry-After without
    checking the password."""
    now = utcnow()
    failures, oldest = (
        await session.execute(
            select(func.count(), func.min(LoginFailure.failed_at)).where(
                LoginFailure.username == body.username,
                LoginFailure.failed_at > now - LOGIN_FAILURE_WINDOW,
            )
        )
    ).one()
    if failures >= MAX_LOGIN_FAILURES:
        retry_after = math.ceil((oldest + LOGIN_FAILURE_WINDOW - now).total_seconds())
        raise ApiError(
            ErrorCode.too_many_login_attempts, headers={"Retry-After": str(max(retry_after, 1))}
        )

    user = await session.scalar(select(User).where(User.username == body.username))
    if user is None or not await to_thread(verify_password, user.password_hash, body.password):
        session.add(LoginFailure(username=body.username))
        await session.commit()
        raise ApiError(ErrorCode.invalid_credentials)
    await session.execute(delete(LoginFailure).where(LoginFailure.username == body.username))
    return await _issue_tokens(session, settings, user)


@router.post("/refresh", response_model=TokenPair)
async def refresh_tokens(body: RefreshIn, session: SessionDep, settings: SettingsDep) -> TokenPair:
    """Rotates the refresh token. The new one is derived from it: presenting the old one
    again while the new one was never used (the answer lost: the page closed, the network
    gone mid-exchange) gets the same answer again, instead of signing the user out. Once
    the new one was used, the old one showing up again is treated as theft: every session
    of that user is revoked (unless that use was in the last REFRESH_REUSE_GRACE:
    `refresh_token_rotated`). A token revoked by logout or a password change is just
    rejected."""
    token = await session.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_refresh_token(body.refresh_token))
        .with_for_update()
    )
    if token is None:
        raise ApiError(ErrorCode.invalid_refresh_token)

    now = utcnow()
    successor = successor_refresh_token(settings.secret_key, body.refresh_token)
    if token.revoked_at is not None:
        if not token.rotated:
            raise ApiError(ErrorCode.invalid_refresh_token)
        exchanged_for = await session.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == successor[1]).with_for_update()
        )
        if (
            exchanged_for is not None
            and exchanged_for.revoked_at is None
            and exchanged_for.expires_at > now
        ):
            # What it was exchanged for never came back: the same answer again.
            user = await session.get(User, token.user_id)
            if user is None:
                raise ApiError(ErrorCode.invalid_refresh_token)
            return await _issue_tokens(session, settings, user, successor, stored=True)
        if now - token.revoked_at < REFRESH_REUSE_GRACE:
            raise ApiError(ErrorCode.refresh_token_rotated)
        await _revoke_sessions(session, token.user_id)
        await session.commit()
        raise ApiError(ErrorCode.refresh_token_reused)
    if token.expires_at <= now:
        raise ApiError(ErrorCode.refresh_token_expired)

    user = await session.get(User, token.user_id)
    if user is None:
        raise ApiError(ErrorCode.invalid_refresh_token)
    token.revoked_at = now
    token.rotated = True
    return await _issue_tokens(session, settings, user, successor)


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
async def get_me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserOut)
async def update_me(body: ProfilePatch, session: SessionDep, user: CurrentUser) -> User:
    if "display_name" in body.model_fields_set:
        user.display_name = body.display_name
    await session.commit()
    return user


@router.post("/me/password", response_model=TokenPair)
async def change_password(
    body: PasswordChange, session: SessionDep, settings: SettingsDep, user: CurrentUser
) -> TokenPair:
    """Signs out every other session (their refresh tokens are revoked; access tokens
    expire within minutes) and returns fresh tokens for this one."""
    if not await to_thread(verify_password, user.password_hash, body.current_password):
        raise ApiError(ErrorCode.wrong_password)
    user.password_hash = await to_thread(hash_password, body.new_password)
    await _revoke_sessions(session, user.id)
    return await _issue_tokens(session, settings, user)


@router.put("/me/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile, session: SessionDep, settings: SettingsDep, user: CurrentUser
) -> User:
    """JPEG/PNG/WebP. Served like covers: `/covers/{avatar_id}?size=64|300|600`."""
    data = await file.read(MAX_AVATAR_BYTES + 1)
    if len(data) > MAX_AVATAR_BYTES:
        raise ApiError(ErrorCode.image_too_large)
    picture = await store_cover(session, settings.covers_path, data)
    if picture is None:
        raise ApiError(ErrorCode.not_an_image)
    user.avatar_id = picture.id
    await session.commit()
    return user


@router.delete("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
async def delete_avatar(session: SessionDep, user: CurrentUser) -> None:
    user.avatar_id = None
    await session.commit()


async def _user_by_name(session: AsyncSession, username: str) -> User:
    user = await session.scalar(select(User).where(User.username == username))
    if user is None:
        raise ApiError(ErrorCode.user_not_found)
    return user


@users_router.get("", response_model=list[UserAdminOut])
async def list_users(session: SessionDep, _: AdminUser) -> list[UserAdminOut]:
    """Oldest first, so the first administrator leads."""
    sessions = dict(
        (
            await session.execute(
                select(RefreshToken.user_id, func.count())
                .where(RefreshToken.revoked_at.is_(None), RefreshToken.expires_at > utcnow())
                .group_by(RefreshToken.user_id)
            )
        ).all()
    )
    return [
        UserAdminOut(
            **UserOut.model_validate(user).model_dump(),
            last_seen_at=user.last_seen_at,
            sessions=sessions.get(user.id, 0),
        )
        for user in await session.scalars(select(User).order_by(User.created_at))
    ]


@users_router.patch("/{username}", response_model=UserOut)
async def update_user(
    username: str, body: UserPatch, session: SessionDep, admin: AdminUser
) -> User:
    user = await _user_by_name(session, username)
    if user.id == admin.id and body.role != user.role:
        # Keeps the server from ending up without an admin.
        raise ApiError(ErrorCode.cannot_change_own_role)
    user.role = body.role
    await session.commit()
    return user


@users_router.post("/{username}/password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    username: str, body: PasswordReset, session: SessionDep, _: AdminUser
) -> None:
    """Sets a new password for a user and signs out all their sessions."""
    user = await _user_by_name(session, username)
    user.password_hash = await to_thread(hash_password, body.new_password)
    await _revoke_sessions(session, user.id)
    await session.commit()


@users_router.delete("/{username}/sessions", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out_user(username: str, session: SessionDep, _: AdminUser) -> None:
    """Signs the user out on every device (an access token already issued keeps working
    until it expires, within minutes)."""
    user = await _user_by_name(session, username)
    await _revoke_sessions(session, user.id)
    await session.commit()


@users_router.delete("/{username}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(username: str, session: SessionDep, admin: AdminUser) -> None:
    user = await _user_by_name(session, username)
    if user.id == admin.id:
        raise ApiError(ErrorCode.cannot_delete_self)
    await session.delete(user)
    await session.commit()
