"""User settings stored on the server, so every client (web, Android, Linux) looks the same."""

from typing import Annotated, Any, Literal

from pydantic import ConfigDict, StringConstraints, ValidationError

from app.media.router import Quality
from app.schemas import ApiModel

Language = Literal["ru", "en"]
HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9a-fA-F]{6}$", to_lower=True)]


class Preferences(ApiModel):
    model_config = ConfigDict(extra="ignore")

    # None: follow the device language.
    language: Language | None = None
    # None: the theme's default accent.
    accent_color: HexColor | None = None
    # Frosted-glass blur behind panels; off renders them opaque (cheaper on weak devices).
    blur: bool = True
    # Tint the background and the glass with the colours of the current track's cover.
    adaptive_color: bool = True
    stream_quality: Quality = Quality.high


class PreferencesPatch(ApiModel):
    """Changes only the fields that are sent; `null` resets a field to its default."""

    model_config = ConfigDict(extra="forbid")

    language: Language | None = None
    accent_color: HexColor | None = None
    blur: bool | None = None
    adaptive_color: bool | None = None
    stream_quality: Quality | None = None


def load_preferences(stored: dict[str, Any]) -> Preferences:
    """Stored values that no longer validate (an option removed later) fall back to defaults."""
    try:
        return Preferences.model_validate(stored)
    except ValidationError as exc:
        invalid = {error["loc"][0] for error in exc.errors()}
        return Preferences.model_validate({k: v for k, v in stored.items() if k not in invalid})
