from datetime import date, datetime, time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.repositories.user_flow import get_public_found_item_by_id, list_public_found_items
from app.schemas.found_item import FoundItemDetailResponse, FoundItemListItemResponse
from app.services.mappers import found_item_detail_response, found_item_list_response

router = APIRouter(prefix="/api/found-items", tags=["found-items"])


@router.get("", response_model=list[FoundItemListItemResponse], summary="발견물 목록 조회")
def list_found_items(
    db: Annotated[Session, Depends(get_db)],
    skip: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    item_category: Annotated[str | None, Query()] = None,
    color: Annotated[str | None, Query()] = None,
    area_name: Annotated[str | None, Query()] = None,
    q: Annotated[str | None, Query()] = None,
    status: Annotated[str | None, Query()] = None,
    found_date: Annotated[date | None, Query()] = None,
) -> list[FoundItemListItemResponse]:
    items = list_public_found_items(
        db,
        skip=skip,
        limit=limit,
        item_category=item_category,
        color=color,
        area_name=area_name,
        q=q,
        status=status,
        found_date=datetime.combine(found_date, time.min) if found_date else None,
    )
    return [found_item_list_response(item) for item in items]


@router.get("/{id}", response_model=FoundItemDetailResponse, summary="발견물 상세 조회")
def get_found_item(
    id: Annotated[int, Path(ge=1)],
    db: Annotated[Session, Depends(get_db)],
) -> FoundItemDetailResponse:
    item = get_public_found_item_by_id(db, id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Found item not found")
    return found_item_detail_response(item)
