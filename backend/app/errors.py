"""Error responses: `{"code": ..., "detail": ...}`.

`code` is stable and machine-readable, so clients can translate it; `detail` is an English
message for logs and developers (for validation errors, the list of failed fields)."""

import enum

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.utils import is_body_allowed_for_status_code
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorCode(enum.StrEnum):
    # generic, for errors raised outside our code (unknown route, wrong method, ...)
    bad_request = "bad_request"
    forbidden = "forbidden"
    not_found = "not_found"
    method_not_allowed = "method_not_allowed"
    validation_error = "validation_error"
    http_error = "http_error"
    # auth
    not_authenticated = "not_authenticated"
    invalid_token = "invalid_token"
    admin_only = "admin_only"
    registration_closed = "registration_closed"
    username_taken = "username_taken"
    invalid_credentials = "invalid_credentials"
    too_many_login_attempts = "too_many_login_attempts"
    invalid_refresh_token = "invalid_refresh_token"
    refresh_token_rotated = "refresh_token_rotated"
    refresh_token_reused = "refresh_token_reused"
    refresh_token_expired = "refresh_token_expired"
    user_not_found = "user_not_found"
    cannot_delete_self = "cannot_delete_self"
    cannot_change_own_role = "cannot_change_own_role"
    wrong_password = "wrong_password"
    not_an_image = "not_an_image"
    image_too_large = "image_too_large"
    # library and media
    artist_not_found = "artist_not_found"
    album_not_found = "album_not_found"
    track_not_found = "track_not_found"
    not_an_audio_file = "not_an_audio_file"
    tags_not_writable = "tags_not_writable"
    unknown_albums = "unknown_albums"
    genre_not_found = "genre_not_found"
    invalid_stream_signature = "invalid_stream_signature"
    audio_file_missing = "audio_file_missing"
    cover_not_found = "cover_not_found"
    cover_file_missing = "cover_file_missing"
    invalid_cover_size = "invalid_cover_size"
    lyrics_not_found = "lyrics_not_found"
    job_not_found = "job_not_found"
    library_not_writable = "library_not_writable"
    disk_full = "disk_full"
    # playlists
    playlist_not_found = "playlist_not_found"
    playlist_item_not_found = "playlist_item_not_found"
    unknown_tracks = "unknown_tracks"


# Status code and default message of each error raised by our code.
_ERRORS: dict[ErrorCode, tuple[int, str]] = {
    ErrorCode.not_authenticated: (401, "Not authenticated"),
    ErrorCode.invalid_token: (401, "Invalid or expired token"),
    ErrorCode.admin_only: (403, "Admin only"),
    ErrorCode.registration_closed: (403, "Only admins can create users"),
    ErrorCode.username_taken: (409, "Username already taken"),
    ErrorCode.invalid_credentials: (401, "Invalid username or password"),
    ErrorCode.too_many_login_attempts: (429, "Too many failed logins, try again later"),
    ErrorCode.invalid_refresh_token: (401, "Invalid refresh token"),
    ErrorCode.refresh_token_rotated: (401, "Refresh token was just rotated"),
    ErrorCode.refresh_token_reused: (401, "Refresh token reuse detected"),
    ErrorCode.refresh_token_expired: (401, "Refresh token expired"),
    ErrorCode.user_not_found: (404, "User not found"),
    ErrorCode.cannot_delete_self: (400, "Cannot delete yourself"),
    ErrorCode.cannot_change_own_role: (400, "Cannot change your own role"),
    ErrorCode.wrong_password: (400, "Current password is wrong"),
    ErrorCode.not_an_image: (415, "Not a supported image"),
    ErrorCode.image_too_large: (413, "Image is too large"),
    ErrorCode.artist_not_found: (404, "Artist not found"),
    ErrorCode.album_not_found: (404, "Album not found"),
    ErrorCode.track_not_found: (404, "Track not found"),
    ErrorCode.not_an_audio_file: (415, "Not an audio file, cover image or lyrics file"),
    ErrorCode.tags_not_writable: (415, "Tags can't be written to this file's format"),
    ErrorCode.unknown_albums: (404, "Unknown albums"),
    ErrorCode.genre_not_found: (404, "No albums of this genre"),
    ErrorCode.invalid_stream_signature: (401, "Missing or invalid signature"),
    ErrorCode.audio_file_missing: (404, "Audio file is missing on disk"),
    ErrorCode.cover_not_found: (404, "Cover not found"),
    ErrorCode.cover_file_missing: (404, "Cover file is missing"),
    ErrorCode.invalid_cover_size: (422, "Unsupported cover size"),
    ErrorCode.lyrics_not_found: (404, "No lyrics for this track"),
    ErrorCode.job_not_found: (404, "No such failed job"),
    ErrorCode.library_not_writable: (503, "The server can't write to the music library folder"),
    ErrorCode.disk_full: (507, "No space left on the server's disk"),
    ErrorCode.playlist_not_found: (404, "Playlist not found"),
    ErrorCode.playlist_item_not_found: (404, "Playlist item not found"),
    ErrorCode.unknown_tracks: (404, "Unknown tracks"),
}

_BY_STATUS = {
    400: ErrorCode.bad_request,
    401: ErrorCode.not_authenticated,
    403: ErrorCode.forbidden,
    404: ErrorCode.not_found,
    405: ErrorCode.method_not_allowed,
    422: ErrorCode.validation_error,
}


class ApiError(HTTPException):
    def __init__(
        self, code: ErrorCode, detail: str | None = None, headers: dict[str, str] | None = None
    ) -> None:
        status_code, message = _ERRORS[code]
        super().__init__(status_code, detail or message, headers)
        self.code = code


class ValidationIssue(BaseModel):
    loc: list[str | int]
    msg: str
    type: str


class ErrorOut(BaseModel):
    code: ErrorCode
    detail: str | list[ValidationIssue]


# Documents ErrorOut as the body of every 4xx response (replaces FastAPI's 422 schema).
ERROR_RESPONSES: dict[int | str, dict] = {"4XX": {"model": ErrorOut, "description": "Error"}}


async def _http_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, StarletteHTTPException)
    headers = getattr(exc, "headers", None)
    if not is_body_allowed_for_status_code(exc.status_code):
        return Response(status_code=exc.status_code, headers=headers)
    code = getattr(exc, "code", None) or _BY_STATUS.get(exc.status_code, ErrorCode.http_error)
    return JSONResponse(
        {"code": code, "detail": exc.detail}, status_code=exc.status_code, headers=headers
    )


async def _validation_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, RequestValidationError)
    return JSONResponse(
        {"code": ErrorCode.validation_error, "detail": jsonable_encoder(exc.errors())},
        status_code=422,
    )


def install_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(StarletteHTTPException, _http_error)
    app.add_exception_handler(RequestValidationError, _validation_error)
