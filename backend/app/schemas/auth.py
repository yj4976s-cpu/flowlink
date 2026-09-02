from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

PASSWORD_POLICY_MESSAGE = "비밀번호는 8~128자이며 영문 대문자, 영문 소문자, 숫자, 특수문자를 각각 1개 이상 포함해야 합니다."
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128


def is_ascii_punctuation(character: str) -> bool:
    code_point = ord(character)
    return (
        33 <= code_point <= 47
        or 58 <= code_point <= 64
        or 91 <= code_point <= 96
        or 123 <= code_point <= 126
    )


def validate_new_password(value: str) -> str:
    valid = (
        PASSWORD_MIN_LENGTH <= len(value) <= PASSWORD_MAX_LENGTH
        and any("A" <= character <= "Z" for character in value)
        and any("a" <= character <= "z" for character in value)
        and any("0" <= character <= "9" for character in value)
        and any(is_ascii_punctuation(character) for character in value)
    )
    if not valid:
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
