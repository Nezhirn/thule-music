import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.auth.models import Role


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class RegisterIn(BaseModel):
    username: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=256)
    display_name: str | None = Field(default=None, max_length=128)
    role: Role = Role.user


class RefreshIn(BaseModel):
    refresh_token: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class ProfilePatch(BaseModel):
    display_name: str | None = Field(default=None, max_length=128)

    @field_validator("display_name")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return (value or "").strip() or None


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=8, max_length=256)


class PasswordReset(BaseModel):
    new_password: str = Field(min_length=8, max_length=256)


class UserPatch(BaseModel):
    role: Role


class SetupStatus(BaseModel):
    # True until the first account exists: the client should offer to create the admin.
    needs_setup: bool


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str | None
    role: Role
    avatar_id: uuid.UUID | None
    created_at: datetime
