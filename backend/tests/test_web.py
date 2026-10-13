"""The built web app served next to the API (THULE_WEB_PATH)."""

import base64
import hashlib
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest

from app.config import Settings
from app.main import create_app
from app.web import content_security_policy

INLINE = "window.thule = 1;"
INDEX = f"""<!doctype html>
<html><head><title>Thule</title>
<script>{INLINE}</script>
<script type="module" src="/assets/app-1a2b.js"></script>
</head><body><div id="root"></div></body></html>"""
SCRIPT = b"console.log('the app');" * 50


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(INDEX)
    (dist / "assets" / "app-1a2b.js").write_bytes(SCRIPT)
    # Stand-ins for the compressed copies: only which one is sent matters here.
    (dist / "assets" / "app-1a2b.js.br").write_bytes(b"brotli")
    (dist / "assets" / "app-1a2b.js.gz").write_bytes(b"gzip")
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("outside the app")
    return dist


@pytest.fixture
async def web(settings: Settings, sessionmaker, dist: Path) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings.model_copy(update={"web_path": dist}))
    app.state.sessionmaker = sessionmaker
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


async def raw(client: httpx.AsyncClient, url: str, encodings: str) -> tuple[httpx.Response, bytes]:
    """The response and its body as sent (httpx would decode a compressed one)."""
    headers = {"Accept-Encoding": encodings}
    async with client.stream("GET", url, headers=headers) as resp:
        return resp, b"".join([chunk async for chunk in resp.aiter_raw()])


async def test_every_page_of_the_app_gets_index_html(web):
    for path in ("/", "/albums/4f1c", "/admin/users", "/search?q=polar", "/docs"):
        resp = await web.get(path)
        assert resp.status_code == 200, path
        assert resp.text == INDEX
        assert resp.headers["content-type"] == "text/html; charset=utf-8"
        # A new release is picked up on the next load.
        assert resp.headers["cache-control"] == "no-cache"
        assert resp.headers["x-content-type-options"] == "nosniff"
        assert resp.headers["referrer-policy"] == "same-origin"
        assert "default-src 'self'" in resp.headers["content-security-policy"]

    resp = await web.head("/albums/4f1c")
    assert resp.status_code == 200
    assert resp.headers["content-length"] == str(len(INDEX.encode()))
    assert resp.content == b""


async def test_the_policy_allows_the_pages_own_inline_scripts():
    digest = base64.b64encode(hashlib.sha256(INLINE.encode()).digest()).decode()
    policy = content_security_policy(INDEX)
    assert f"script-src 'self' 'sha256-{digest}';" in policy
    assert "frame-ancestors 'none'" in policy
    assert "object-src 'none'" in policy

    built = '<script type="module" crossorigin src="/assets/index-x.js"></script>'
    assert "script-src 'self';" in content_security_policy(built)


async def test_build_files_are_cached_for_good_and_sent_compressed(web):
    resp, body = await raw(web, "/assets/app-1a2b.js", "gzip, deflate, br, zstd")
    assert resp.status_code == 200
    assert body == b"brotli"
    assert resp.headers["content-encoding"] == "br"
    assert resp.headers["content-type"].startswith("text/javascript")
    assert resp.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert "Accept-Encoding" in resp.headers["vary"]
    assert "content-security-policy" not in resp.headers

    resp, body = await raw(web, "/assets/app-1a2b.js", "br;q=0, gzip")
    assert (body, resp.headers["content-encoding"]) == (b"gzip", "gzip")

    resp, body = await raw(web, "/assets/app-1a2b.js", "identity")
    assert body == SCRIPT
    assert "content-encoding" not in resp.headers
    assert "Accept-Encoding" in resp.headers["vary"]

    # Revalidation: the browser's copy is still good.
    resp, _ = await raw(web, "/assets/app-1a2b.js", "br")
    again = await web.get(
        "/assets/app-1a2b.js",
        headers={"Accept-Encoding": "br", "If-None-Match": resp.headers["etag"]},
    )
    assert again.status_code == 304

    resp = await web.get("/favicon.svg")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/svg+xml"
    assert resp.headers["cache-control"] == "no-cache"
    assert "Accept-Encoding" not in resp.headers.get("vary", "")


async def test_missing_files_and_api_paths_are_not_pages(web):
    for path in ("/assets/app-old.js", "/assets/later", "/favicon.ico", "/api/v1/no-such-route"):
        resp = await web.get(path)
        assert resp.status_code == 404, path
        assert resp.json()["code"] == "not_found"

    resp = await web.get("/api/v1/health")
    assert resp.json() == {"status": "ok"}
    # The API's own answers stay as they are.
    resp = await web.delete("/api/v1/health")
    assert resp.status_code == 405
    assert resp.json()["code"] == "method_not_allowed"
    resp = await web.post("/albums")
    assert resp.status_code == 405
    assert resp.json()["code"] == "method_not_allowed"

    resp = await web.get("/api/docs")
    assert resp.status_code == 200
    assert "swagger" in resp.text.lower()


async def test_nothing_outside_the_app_folder_is_served(web):
    for path in ("/..%2fsecret.txt", "/assets/..%2f..%2fsecret.txt", "/%2e%2e/secret.txt"):
        resp = await web.get(path)
        assert resp.status_code == 404, path
        assert "outside the app" not in resp.text


async def test_without_a_built_app_the_server_refuses_to_start(settings, tmp_path):
    with pytest.raises(RuntimeError, match="has no index.html"):
        create_app(settings.model_copy(update={"web_path": tmp_path / "missing"}))
