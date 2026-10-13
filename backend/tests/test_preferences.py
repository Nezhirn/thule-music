import asyncio

from app.me.preferences import load_preferences

DEFAULTS = {
    "language": None,
    "accent_color": None,
    "blur": True,
    "adaptive_color": True,
    "stream_quality": "high",
}


async def test_defaults_update_and_reset(client, admin, user):
    assert (await client.get("/me/preferences", headers=user)).json() == DEFAULTS

    resp = await client.patch(
        "/me/preferences",
        json={"language": "ru", "accent_color": "#E5484D", "blur": False},
        headers=user,
    )
    assert resp.status_code == 200, resp.text
    changed = {**DEFAULTS, "language": "ru", "accent_color": "#e5484d", "blur": False}
    assert resp.json() == changed
    assert (await client.get("/me/preferences", headers=user)).json() == changed

    # Untouched fields stay; null resets to the default.
    resp = await client.patch("/me/preferences", json={"blur": None}, headers=user)
    assert resp.json() == {**changed, "blur": True}

    # Preferences are per user.
    assert (await client.get("/me/preferences", headers=admin)).json() == DEFAULTS


async def test_invalid_preferences_are_rejected(client, user):
    for body in ({"accent_color": "red"}, {"language": "de"}, {"bluur": False}):
        resp = await client.patch("/me/preferences", json=body, headers=user)
        assert resp.status_code == 422, body
        assert resp.json()["code"] == "validation_error"


async def test_concurrent_updates_keep_both_changes(client, user):
    await asyncio.gather(
        client.patch("/me/preferences", json={"language": "en"}, headers=user),
        client.patch("/me/preferences", json={"stream_quality": "low"}, headers=user),
    )
    prefs = (await client.get("/me/preferences", headers=user)).json()
    assert prefs["language"] == "en" and prefs["stream_quality"] == "low"


def test_stale_stored_values_fall_back_to_defaults():
    prefs = load_preferences({"language": "klingon", "blur": False, "removed_option": 1})
    assert prefs.language is None and prefs.blur is False
