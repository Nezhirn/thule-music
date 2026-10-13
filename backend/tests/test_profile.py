from app.auth import router as auth_router
from tests.conftest import png_bytes


async def login(client, username: str, password: str):
    return await client.post("/auth/login", json={"username": username, "password": password})


async def test_display_name(client, user):
    resp = await client.patch("/auth/me", json={"display_name": "  Andrey "}, headers=user)
    assert resp.status_code == 200
    assert resp.json()["display_name"] == "Andrey"
    resp = await client.patch("/auth/me", json={"display_name": ""}, headers=user)
    assert resp.json()["display_name"] is None
    # Fields that are not sent stay as they are.
    await client.patch("/auth/me", json={"display_name": "A"}, headers=user)
    assert (await client.patch("/auth/me", json={}, headers=user)).json()["display_name"] == "A"


async def test_change_password_signs_out_other_sessions(client, user):
    other = (await login(client, "listener", "listener-password")).json()

    wrong = await client.post(
        "/auth/me/password",
        json={"current_password": "nope", "new_password": "new-password"},
        headers=user,
    )
    assert wrong.status_code == 400 and wrong.json()["code"] == "wrong_password"

    resp = await client.post(
        "/auth/me/password",
        json={"current_password": "listener-password", "new_password": "new-password"},
        headers=user,
    )
    assert resp.status_code == 200
    fresh = resp.json()

    stale = await client.post("/auth/refresh", json={"refresh_token": other["refresh_token"]})
    assert stale.status_code == 401
    # The signed-out device trying its old token must not sign out this one.
    ok = await client.post("/auth/refresh", json={"refresh_token": fresh["refresh_token"]})
    assert ok.status_code == 200
    assert (await login(client, "listener", "listener-password")).status_code == 401
    assert (await login(client, "listener", "new-password")).status_code == 200


async def test_admin_resets_password_and_changes_role(client, admin, user):
    session = (await login(client, "listener", "listener-password")).json()
    body = {"new_password": "reset-password"}

    assert (
        await client.post("/users/listener/password", json=body, headers=user)
    ).status_code == 403
    resp = await client.post("/users/listener/password", json=body, headers=admin)
    assert resp.status_code == 204
    revoked = await client.post("/auth/refresh", json={"refresh_token": session["refresh_token"]})
    assert revoked.status_code == 401
    assert (await login(client, "listener", "reset-password")).status_code == 200

    resp = await client.patch("/users/listener", json={"role": "admin"}, headers=admin)
    assert resp.json()["role"] == "admin"
    own = await client.patch("/users/admin", json={"role": "user"}, headers=admin)
    assert own.status_code == 400 and own.json()["code"] == "cannot_change_own_role"
    missing = await client.post("/users/ghost/password", json=body, headers=admin)
    assert missing.json()["code"] == "user_not_found"


async def test_avatar_upload_and_removal(client, user, monkeypatch):
    assert (await client.get("/auth/me", headers=user)).json()["avatar_id"] is None

    resp = await client.put(
        "/auth/me/avatar", files={"file": ("me.png", png_bytes((10, 200, 30)))}, headers=user
    )
    assert resp.status_code == 200, resp.text
    avatar_id = resp.json()["avatar_id"]
    thumb = await client.get(f"/covers/{avatar_id}?size=64")
    assert thumb.status_code == 200 and thumb.headers["content-type"] == "image/jpeg"

    bad = await client.put("/auth/me/avatar", files={"file": ("x.png", b"nope")}, headers=user)
    assert bad.status_code == 415 and bad.json()["code"] == "not_an_image"
    monkeypatch.setattr(auth_router, "MAX_AVATAR_BYTES", 100)
    big = await client.put(
        "/auth/me/avatar", files={"file": ("big.png", png_bytes((1, 2, 3), 256))}, headers=user
    )
    assert big.status_code == 413 and big.json()["code"] == "image_too_large"

    assert (await client.delete("/auth/me/avatar", headers=user)).status_code == 204
    assert (await client.get("/auth/me", headers=user)).json()["avatar_id"] is None
