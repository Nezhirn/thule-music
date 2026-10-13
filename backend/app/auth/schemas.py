import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

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


class SetupStatus(BaseModel):
    # True until the first account exists: the client should offer to create the admin.
    needs_setup: bool


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    username: str
    display_name: str | None
    role: Role
    created_at: datetime
