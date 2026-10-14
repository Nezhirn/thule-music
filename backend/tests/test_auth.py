import asyncio
import time
from datetime import timedelta

import httpx
import pytest
from fastapi import Request
from pydantic import ValidationError
from sqlalchemy import func, select, update

from app import deps
from app.auth.models import LoginFailure, RefreshToken, User
from app.auth.router import REFRESH_REUSE_GRACE
from app.auth.security import create_access_token
from app.config import Settings
from app.main import create_app
from tests.conftest import register_and_login


async def test_first_user_becomes_admin_then_registration_closes(client):
    resp = await client.post("/auth/register", json={"username": "boss", "password": "password1"})
    assert resp.status_code == 201
    assert resp.json()["role"] == "admin"

    resp = await client.post("/auth/register", json={"username": "eve", "password": "password1"})
    assert resp.status_code == 403


async def test_setup_status(client):
    assert (await client.get("/auth/setup")).json() == {"needs_setup": True}
    await client.post("/auth/register", json={"username": "boss", "password": "password1"})
    assert (await client.get("/auth/setup")).json() == {"needs_setup": False}


async def test_concurrent_first_registrations_make_one_admin(client):
    responses = await asyncio.gather(
        *(
            client.post("/auth/register", json={"username": f"u{i}", "password": "password1"})
            for i in range(3)
        )
    )
    assert sorted(r.status_code for r in responses) == [201, 403, 403]


async def test_admin_creates_users(client, admin):
    resp = await client.post(
        "/auth/register",
        json={"username": "bob", "password": "password1", "role": "user"},
        headers=admin,
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "user"

    dup = await client.post(
        "/auth/register", json={"username": "bob", "password": "password1"}, headers=admin
    )
    assert dup.status_code == 409

    users = await client.get("/users", headers=admin)
    assert [u["username"] for u in users.json()] == ["admin", "bob"]


async def test_non_admin_cannot_manage_users(client, user):
    assert (await client.get("/users", headers=user)).status_code == 403
    resp = await client.post(
        "/auth/register", json={"username": "x1", "password": "password1"}, headers=user
    )
    assert resp.status_code == 403


async def test_login_and_me(client, admin):
    bad = await client.post("/auth/login", json={"username": "admin", "password": "wrong"})
    assert bad.status_code == 401

    me = await client.get("/auth/me", headers=admin)
    assert me.status_code == 200
    assert me.json()["username"] == "admin"

    assert (await client.get("/auth/me")).status_code == 401
    garbage = await client.get("/auth/me", headers={"Authorization": "Bearer nope"})
    assert garbage.status_code == 401


async def _age_rotation(sessionmaker) -> None:
    """Moves every rotation back past the grace period."""
    async with sessionmaker() as session:
        await session.execute(
            update(RefreshToken)
            .where(RefreshToken.revoked_at.is_not(None))
            .values(revoked_at=RefreshToken.revoked_at - REFRESH_REUSE_GRACE)
        )
        await session.commit()


async def test_refresh_rotation_and_reuse_detection(client, sessionmaker):
    await register_and_login(client, "admin", "admin-password")
    login = (
        await client.post("/auth/login", json={"username": "admin", "password": "admin-password"})
    ).json()

    first = await client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert first.status_code == 200
    rotated = first.json()["refresh_token"]
    assert rotated != login["refresh_token"]
    # The new token in use...
    used = await client.post("/auth/refresh", json={"refresh_token": rotated})
    assert used.status_code == 200

    # ...the old one showing up again is treated as theft and kills every session...
    await _age_rotation(sessionmaker)
    replay = await client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert replay.status_code == 401
    assert replay.json()["code"] == "refresh_token_reused"
    # ...including the freshly rotated one.
    after = await client.post("/auth/refresh", json={"refresh_token": used.json()["refresh_token"]})
    assert after.status_code == 401


async def test_a_lost_answer_to_a_refresh_is_given_again(client, sessionmaker):
    """The page closed or the network went mid-exchange: the server rotated the token, the
    client never got the new one. Presenting the old one again, even much later, gets the
    same answer instead of signing the user out (or out everywhere)."""
    await register_and_login(client, "admin", "admin-password")
    login = (
        await client.post("/auth/login", json={"username": "admin", "password": "admin-password"})
    ).json()
    lost = await client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
    await _age_rotation(sessionmaker)
    again = await client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert again.status_code == 200
    assert again.json()["refresh_token"] == lost.json()["refresh_token"]
    me = await client.get(
        "/auth/me", headers={"Authorization": f"Bearer {again.json()['access_token']}"}
    )
    assert me.status_code == 200
    on = await client.post("/auth/refresh", json={"refresh_token": again.json()["refresh_token"]})
    assert on.status_code == 200


async def test_replay_right_after_rotation_is_a_race_not_theft(client):
    """Two tabs refreshing with the same token at once both get the new one; one that comes
    after the new one was already used is refused, but the session lives on."""
    await register_and_login(client, "admin", "admin-password")
    login = (
        await client.post("/auth/login", json={"username": "admin", "password": "admin-password"})
    ).json()
    first = await client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
    second = await client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert second.status_code == 200
    assert second.json()["refresh_token"] == first.json()["refresh_token"]
    current = first.json()["refresh_token"]
    after = await client.post("/auth/refresh", json={"refresh_token": current})
    assert after.status_code == 200

    late = await client.post("/auth/refresh", json={"refresh_token": login["refresh_token"]})
    assert late.status_code == 401
    assert late.json()["code"] == "refresh_token_rotated"
    newest = after.json()["refresh_token"]
    still = await client.post("/auth/refresh", json={"refresh_token": newest})
    assert still.status_code == 200


async def test_logout_revokes_refresh_token(client):
    await register_and_login(client, "admin", "admin-password")
    tokens = (
        await client.post("/auth/login", json={"username": "admin", "password": "admin-password"})
    ).json()
    other = (
        await client.post("/auth/login", json={"username": "admin", "password": "admin-password"})
    ).json()
    resp = await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    assert resp.status_code == 204
    again = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert again.status_code == 401
    assert again.json()["code"] == "invalid_refresh_token"
    # A logged-out token is stale, not stolen: other sessions stay signed in.
    still = await client.post("/auth/refresh", json={"refresh_token": other["refresh_token"]})
    assert still.status_code == 200


def test_secret_key_has_no_default(monkeypatch):
    monkeypatch.delenv("THULE_SECRET_KEY", raising=False)
    with pytest.raises(ValidationError, match="secret_key"):
        Settings(_env_file=None)


async def test_failed_logins_are_throttled_per_username(client, admin, sessionmaker):
    wrong = {"username": "admin", "password": "wrong"}
    right = {"username": "admin", "password": "admin-password"}
    for _ in range(10):
        assert (await client.post("/auth/login", json=wrong)).status_code == 401

    # Locked: even the right password is not checked.
    locked = await client.post("/auth/login", json=right)
    assert locked.status_code == 429
    assert locked.json()["code"] == "too_many_login_attempts"
    assert 0 < int(locked.headers["retry-after"]) <= 15 * 60
    # Other accounts are unaffected.
    other = await client.post("/auth/login", json={"username": "ghost", "password": "x"})
    assert other.status_code == 401

    # Once the failures leave the window, logging in works and resets the count.
    async with sessionmaker() as session:
        await session.execute(
            update(LoginFailure).values(failed_at=LoginFailure.failed_at - timedelta(minutes=16))
        )
        await session.commit()
    assert (await client.post("/auth/login", json=right)).status_code == 200
    async with sessionmaker() as session:
        left = await session.scalar(
            select(func.count()).select_from(LoginFailure).where(LoginFailure.username == "admin")
        )
    assert left == 0


async def test_a_token_valid_when_a_long_upload_started_stays_valid(
    client, admin, settings, sessionmaker, monkeypatch
):
    """An upload's body is all read before its token is looked at: a big file may take
    longer than the token lives."""
    async with sessionmaker() as session:
        me = (await session.scalars(select(User).where(User.username == "admin"))).one()
    expired = create_access_token(me.id, me.role.value, settings.secret_key, ttl_seconds=-30)
    headers = {"Authorization": f"Bearer {expired}"}
    monkeypatch.setattr(deps, "request_age", lambda request: 0)
    assert (await client.get("/auth/me", headers=headers)).status_code == 401
    monkeypatch.setattr(deps, "request_age", lambda request: 60)  # began 60 s ago
    assert (await client.get("/auth/me", headers=headers)).status_code == 200


async def test_requests_know_when_they_came_in(settings, sessionmaker):
    app = create_app(settings)
    app.state.sessionmaker = sessionmaker

    @app.get("/when")
    async def when(request: Request) -> dict[str, float]:
        return {"started_at": request.state.started_at}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        started = (await c.get("/when")).json()["started_at"]
    assert abs(time.time() - started) < 5
