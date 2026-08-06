from pydantic import BaseModel


class FoundItemUpdateRequest(BaseModel):
    status: str | None = None
    storage_location: str | None = None
    admin_memo: str | None = None
