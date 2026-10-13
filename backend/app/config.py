from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

AUDIO_EXTENSIONS = frozenset({".mp3", ".flac", ".ogg", ".opus", ".m4a", ".aac", ".wav", ".wma"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="THULE_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://thule:thule@localhost:5432/thule"
    # Postgres schema for our tables (tests use a separate one). pg_trgm lives in `public`.
    db_schema: str = "public"
    # Signs JWTs and stream URLs. No default: a well-known one would let anyone forge tokens.
    secret_key: str

    # Music library root (scanned recursively). Uploads land in `<library_path>/uploads`.
    library_path: Path = Path("./library")
    # Server-owned data: transcodes, covers, thumbnails.
    data_path: Path = Path("./data")
    # The built web app (web/dist), served at "/" next to the API. Unset: the API only (in
    # development the Vite dev server serves the app).
    web_path: Path | None = None

    access_token_ttl_seconds: int = 15 * 60
    refresh_token_ttl_seconds: int = 30 * 24 * 3600
    stream_url_ttl_seconds: int = 6 * 3600

    lrclib_enabled: bool = True
    lrclib_url: str = "https://lrclib.net"

    cors_origins: list[str] = ["http://localhost:5173"]

    worker_poll_interval_seconds: float = 1.0
    housekeeping_interval_seconds: int = 6 * 3600

    @property
    def uploads_path(self) -> Path:
        return self.library_path / "uploads"

    @property
    def covers_path(self) -> Path:
        return self.data_path / "covers"

    @property
    def transcodes_path(self) -> Path:
        return self.data_path / "transcodes"


@lru_cache
def get_settings() -> Settings:
    return Settings()
