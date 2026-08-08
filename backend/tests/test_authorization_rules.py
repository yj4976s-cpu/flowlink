from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.security import utc_now
from app.db.session import Base
from app.models import Notification, User
from app.repositories.user_flow import get_notification_for_user
from app.services.lost_reports import can_view_lost_report
from app.models import LostReport


def make_user(user_id: int, role: str = "USER") -> User:
    return User(
        id=user_id,
        email=f"user{user_id}@example.com",
        password_hash="not-used",
        nickname=f"user{user_id}",
        role=role,
        active=True,
        terms_agreed_at=utc_now(),
        privacy_agreed_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
    )


def make_lost_report(user_id: int) -> LostReport:
    return LostReport(
        id=100,
        user_id=user_id,
        object_class_id=1,
        description="분실 신고",
        area_name="잠실",
        lost_from=utc_now(),
        status="OPEN",
        created_at=utc_now(),
        updated_at=utc_now(),
    )


def test_other_users_lost_report_access_is_denied() -> None:
    report = make_lost_report(user_id=1)

    assert can_view_lost_report(make_user(1), report)
    assert not can_view_lost_report(make_user(2), report)
    assert can_view_lost_report(make_user(2, role="ADMIN"), report)


def test_other_users_notification_access_is_denied() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine, class_=Session)

    with SessionLocal() as db:
        db.add(make_user(1))
        db.add(make_user(2))
        db.add(
            Notification(
                id=1,
                user_id=1,
                notification_type="MATCH_FOUND",
                title="매칭",
                message="매칭 후보가 있습니다.",
                created_at=utc_now(),
            )
        )
        db.commit()

        assert get_notification_for_user(db, notification_id=1, user_id=1) is not None
        assert get_notification_for_user(db, notification_id=1, user_id=2) is None
