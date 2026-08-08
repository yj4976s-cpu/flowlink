from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    nickname: str = Field(min_length=2, max_length=50)
    terms_agreed: bool
    privacy_agreed: bool


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    nickname: str
    role: str
    active: bool
    created_at: datetime


class TokenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse
