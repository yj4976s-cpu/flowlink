from __future__ import annotations

from dataclasses import dataclass

import httpx

from app.core.config import get_settings


@dataclass(frozen=True)
class Coordinates:
    latitude: float
    longitude: float


class GeocodingError(RuntimeError):
    pass


def geocode_location(query: str) -> Coordinates | None:
    settings = get_settings()
    if not settings.KAKAO_REST_API_KEY:
        raise GeocodingError("Kakao geocoding is not configured")

    headers = {"Authorization": f"KakaoAK {settings.KAKAO_REST_API_KEY}"}
    try:
        with httpx.Client(timeout=8) as client:
            for path in ("search/address.json", "search/keyword.json"):
                response = client.get(
                    f"https://dapi.kakao.com/v2/local/{path}",
                    headers=headers,
                    params={"query": query, "size": 1},
                )
                response.raise_for_status()
                documents = response.json().get("documents", [])
                if documents:
                    return Coordinates(latitude=float(documents[0]["y"]), longitude=float(documents[0]["x"]))
    except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
        raise GeocodingError("Kakao location lookup failed") from exc
    return None
