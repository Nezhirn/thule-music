import uuid
from datetime import datetime

from pydantic import ConfigDict, Field, field_validator

from app.auth.models import Role
from app.schemas import ApiModel


class Credentials(ApiModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class RegisterIn(ApiModel):
    username: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=128)
    role: Role = Role.user


class RefreshIn(ApiModel):
    refresh_token: str


class TokenPair(ApiModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class ProfilePatch(ApiModel):
    display_name: str | None = Field(default=None, max_length=128)

    @field_validator("display_name")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class PasswordChange(ApiModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


class PasswordReset(ApiModel):
    new_password: str = Field(min_length=8, max_length=256)


class UserPatch(ApiModel):
    role: Role


class SetupStatus(ApiModel):
    # True until the first account exists: the client should offer to create the admin.
    needs_setup: bool


class UserOut(ApiModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str | None
    role: Role
    avatar_id: uuid.UUID | None
    created_at: datetime


class UserAdminOut(UserOut):
    """A user as administrators see them."""

    last_seen_at: datetime | None
    # Devices signed in: unexpired refresh tokens.
    sessions: int
