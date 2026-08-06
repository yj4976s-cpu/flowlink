from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    nickname: str = Field(min_length=2, max_length=50)
    terms_agreed: bool
    privacy_agreed: bool


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
