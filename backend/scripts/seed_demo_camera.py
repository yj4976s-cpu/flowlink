from __future__ import annotations

import argparse
from decimal import Decimal
from sqlalchemy import select
from app.core.security import utc_now
from app.db.session import SessionLocal
from app.models import Camera


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update an active FlowLink demo camera.")
    parser.add_argument("--code", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--area", required=True)
    parser.add_argument("--latitude", required=True, type=Decimal)
    parser.add_argument("--longitude", required=True, type=Decimal)
    args = parser.parse_args()
    if not Decimal("-90") <= args.latitude <= Decimal("90") or not Decimal("-180") <= args.longitude <= Decimal("180"):
        raise SystemExit("latitude/longitude is outside the valid range")
    now = utc_now()
    with SessionLocal() as db:
        camera = db.scalar(select(Camera).where(Camera.code == args.code.strip()))
        if camera is None:
            camera = Camera(code=args.code.strip(), created_at=now)
            db.add(camera)
        camera.name, camera.area_name = args.name.strip(), args.area.strip()
        camera.latitude, camera.longitude = args.latitude, args.longitude
        camera.is_active, camera.updated_at = True, now
        db.commit(); db.refresh(camera)
        print(f"camera_id={camera.id} code={camera.code} area={camera.area_name}")


if __name__ == "__main__":
    main()
