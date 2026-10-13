"""Serves the built web app (`web/dist`) next to the API: in production the browser talks to
one origin, as it does through the dev server's proxy.

- A path that isn't a file is one of the app's own pages (/albums/…, /settings): it gets
  index.html and the app's router takes it from there. Paths under /api and paths that name
  a file (/assets/x.js, /favicon.ico) that isn't there get a 404 instead: a missing script
  must not come back as a page.
- Build files under /assets have content hashes in their names: they are cached for a year.
  Everything else, index.html first of all, is revalidated on every load, so a new release is
  picked up at once.
- Copies compressed at build time (`.br`, `.gz` beside the file) go to browsers that accept
  them.
- Pages carry a Content Security Policy: the app loads nothing from other origins, and a
  script injected into a page can't run or send data elsewhere. The refresh token lives in
  localStorage, so this is what keeps an injected script from reading it out.
"""

import base64
import hashlib
import mimetypes
import os
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath

from starlette.datastructures import Headers
from starlette.exceptions import HTTPException
from starlette.responses import FileResponse, Response
from starlette.staticfiles import NotModifiedResponse, StaticFiles
from starlette.types import Scope

ASSETS = "assets"
IMMUTABLE = "public, max-age=31536000, immutable"
REVALIDATE = "no-cache"
# Preferred first.
ENCODINGS = (("br", ".br"), ("gzip", ".gz"))


class _InlineScripts(HTMLParser):
    """Collects the bodies of inline <script> elements (the policy allows them by hash)."""

    def __init__(self) -> None:
        super().__init__()
        self.scripts: list[str] = []
        self._inline = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script" and not any(name == "src" for name, _ in attrs):
            self._inline = True
            self.scripts.append("")

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self._inline = False

    def handle_data(self, data: str) -> None:
        if self._inline:
            self.scripts[-1] += data


def content_security_policy(index_html: str) -> str:
    parser = _InlineScripts()
    parser.feed(index_html)
    hashes = [
        "'sha256-" + base64.b64encode(hashlib.sha256(script.encode()).digest()).decode() + "'"
        for script in parser.scripts
    ]
    directives = {
        "default-src": ["'self'"],
        "script-src": ["'self'", *hashes],
        "style-src": ["'self'"],
        "img-src": ["'self'"],
        "media-src": ["'self'"],
        "connect-src": ["'self'"],
        "object-src": ["'none'"],
        "base-uri": ["'none'"],
        "form-action": ["'self'"],
        "frame-ancestors": ["'none'"],
    }
    return "; ".join(f"{name} {' '.join(values)}" for name, values in directives.items())


def _accepted(accept_encoding: str) -> set[str]:
    """The content codings an Accept-Encoding header allows (q=0 refuses one)."""
    accepted = set()
    for part in accept_encoding.split(","):
        coding, *params = (param.strip() for param in part.split(";"))
        q = next((param[2:] for param in params if param.startswith("q=")), "1")
        try:
            if coding and float(q) > 0:
                accepted.add(coding.lower())
        except ValueError:
            continue
    return accepted


def _is_page(path: str) -> bool:
    """Whether a path not found among the files is one of the app's pages."""
    parts = PurePosixPath(path).parts
    return not (parts and parts[0] == ASSETS) and PurePosixPath(path).suffix == ""


class WebApp(StaticFiles):
    """The app's files. Installed as the router's fallback rather than mounted at "/": a mount
    would match every path, and a known API path with the wrong method would get this app's
    404 instead of the router's 405."""

    def __init__(self, directory: Path) -> None:
        index = directory / "index.html"
        if not index.is_file():
            raise RuntimeError(
                f"THULE_WEB_PATH={directory} has no index.html: build the web app (npm run build)"
            )
        super().__init__(directory=directory)
        self.assets = os.path.realpath(directory / ASSETS)
        self.page_headers = {
            "Content-Security-Policy": content_security_policy(index.read_text("utf-8")),
            "Referrer-Policy": "same-origin",
        }

    async def get_response(self, path: str, scope: Scope) -> Response:
        if PurePosixPath(path).parts[:1] == ("api",):
            raise HTTPException(404)
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            if exc.status_code != 404 or not _is_page(path):
                raise
        return await super().get_response("index.html", scope)

    def file_response(
        self,
        full_path: str | os.PathLike[str],
        stat_result: os.stat_result,
        scope: Scope,
        status_code: int = 200,
    ) -> Response:
        full_path = os.fspath(full_path)
        request_headers = Headers(scope=scope)
        headers = {"X-Content-Type-Options": "nosniff"}
        if os.path.dirname(full_path) == self.assets:
            headers["Cache-Control"] = IMMUTABLE
        else:
            headers["Cache-Control"] = REVALIDATE
        if full_path.endswith(".html"):
            headers.update(self.page_headers)

        media_type = mimetypes.guess_type(full_path)[0] or "application/octet-stream"
        variants = [(coding, full_path + suffix) for coding, suffix in ENCODINGS]
        variants = [(coding, variant) for coding, variant in variants if os.path.isfile(variant)]
        if variants:
            headers["Vary"] = "Accept-Encoding"
            accepted = _accepted(request_headers.get("accept-encoding", ""))
            for coding, variant in variants:
                if coding in accepted:
                    full_path, stat_result = variant, os.stat(variant)
                    headers["Content-Encoding"] = coding
                    break

        response = FileResponse(
            full_path,
            status_code=status_code,
            headers=headers,
            media_type=media_type,
            stat_result=stat_result,
        )
        if self.is_not_modified(response.headers, request_headers):
            return NotModifiedResponse(response.headers)
        return response
