from datetime import datetime
import re

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

PASSWORD_POLICY_MESSAGE = "비밀번호는 영문과 숫자를 조합해 8~128자로 입력해주세요."
PASSWORD_PATTERN = re.compile(r"^(?=.*[A-Za-z])(?=.*[0-9]).{8,128}$")


def validate_new_password(value: str) -> str:
    if not PASSWORD_PATTERN.fullmatch(value):
        raise ValueError(PASSWORD_POLICY_MESSAGE)
    return value


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    nickname: str = Field(min_length=2, max_length=50)
    terms_agreed: bool
    privacy_agreed: bool

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_new_password(value)

    @field_validator("nickname", mode="before")
    @classmethod
    def strip_nickname(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class OAuthCompleteRequest(BaseModel):
    nickname: str = Field(min_length=2, max_length=50)
    terms_agreed: bool
    privacy_agreed: bool

    @field_validator("nickname", mode="before")
    @classmethod
    def strip_oauth_nickname(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class NicknameUpdateRequest(BaseModel):
    nickname: str = Field(min_length=2, max_length=50)

    @field_validator("nickname", mode="before")
    @classmethod
    def strip_nickname(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def validate_new_password_field(cls, value: str) -> str:
        return validate_new_password(value)


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    nickname: str
    role: str
    active: bool
    created_at: datetime


class LoginResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    expires_in: int
    user: UserResponse
