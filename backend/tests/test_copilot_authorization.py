from datetime import UTC, datetime
from unittest.mock import Mock

import pytest

from app.services.copilot_tools import execute_tool, operations_today_since, tool_definitions, tool_definitions_for_message


def test_guest_has_no_personal_or_admin_tools() -> None:
    assert tool_definitions(None) == []


def test_user_and_admin_receive_different_tool_sets() -> None:
    user_names = {item["name"] for item in tool_definitions("USER")}
    admin_names = {item["name"] for item in tool_definitions("ADMIN")}
    assert "get_my_matches" in user_names
    assert {"get_my_analysis_results", "get_my_ownership_claims"}.issubset(user_names)
    assert "get_operations_summary" not in user_names
    assert admin_names == {"get_operations_summary"}


def test_user_tools_are_filtered_by_message_intent() -> None:
    names = {item["name"] for item in tool_definitions_for_message("USER", "내 매칭 후보만 알려줘")}
    assert names == {"get_my_matches", "get_match_detail"}


def test_tool_execution_rejects_wrong_role_before_database_access() -> None:
    db = Mock()
    admin = Mock(role="ADMIN", id=1)
    user = Mock(role="USER", id=2)
    assert "error" in execute_tool(db, admin, "get_my_matches", {})
    assert "error" in execute_tool(db, user, "get_operations_summary", {})
    assert "error" in execute_tool(db, admin, "get_my_analysis_results", {})
    assert "error" in execute_tool(db, admin, "get_my_ownership_claims", {})
    db.assert_not_called()


def test_user_ownership_claim_tool_projects_only_owner_safe_fields() -> None:
    claim = Mock(
        id=31,
        found_item_id=41,
        lost_report_id=51,
        status="UNDER_REVIEW",
        verification_details="손잡이 안쪽의 영문 이니셜",
        reviewed_at=datetime(2026, 8, 11, tzinfo=UTC),
        created_at=datetime(2026, 8, 10, tzinfo=UTC),
        admin_memo="내부 검토 메모",
        reviewed_by=9,
    )
    db = Mock()
    db.scalars.return_value.all.return_value = [claim]
    user = Mock(role="USER", id=7)

    result = execute_tool(db, user, "get_my_ownership_claims", {"limit": 5})

    assert result == [{
        "id": 31,
        "found_item_id": 41,
        "lost_report_id": 51,
        "status": "UNDER_REVIEW",
        "verification_details": "손잡이 안쪽의 영문 이니셜",
        "reviewed_at": "2026-08-11T00:00:00+00:00",
        "created_at": "2026-08-10T00:00:00+00:00",
    }]
    statement = db.scalars.call_args.args[0]
    assert 7 in statement.compile().params.values()
    assert "admin_memo" not in result[0]
    assert "reviewed_by" not in result[0]


def test_lost_report_tool_payload_excludes_heavy_private_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    report = Mock(
        id=11,
        status="OPEN",
        object_class=Mock(code="BAG", name_ko="가방"),
        colors=["검정"],
        color="검정",
        area_name="서울 한강공원 A구역",
        lost_from=datetime(2026, 8, 11, 9, 0, tzinfo=UTC),
        lost_to=None,
        description="검은색 가방이고 앞쪽에 작은 흠집이 있습니다.",
        image_url="https://private.example/image.jpg",
        private_features="비공개 특징",
    )
    monkeypatch.setattr("app.services.copilot_tools.list_lost_reports_for_user", lambda *_args, **_kwargs: [report])

    result = execute_tool(Mock(), Mock(role="USER", id=7), "get_my_lost_reports", {})

    assert result == [{
        "id": 11,
        "status": "OPEN",
        "item_type": {"code": "BAG", "name_ko": "가방"},
        "colors": ["검정"],
        "lost_location": "서울 한강공원 A구역",
        "lost_time": {"from": "2026-08-11T09:00:00+00:00", "to": None},
        "feature_summary": "검은색 가방이고 앞쪽에 작은 흠집이 있습니다.",
    }]
    assert "image_url" not in result[0]
    assert "private_features" not in result[0]


def test_detection_tool_payload_limits_objects_and_excludes_bounding_boxes(monkeypatch: pytest.MonkeyPatch) -> None:
    objects = [
        Mock(confidence=0.32, object_class=Mock(code="TRASH", name_ko="쓰레기"), bbox_x=1),
        Mock(confidence=0.91, object_class=Mock(code="BAG", name_ko="가방"), bbox_x=2),
        Mock(confidence=0.76, object_class=Mock(code="UMBRELLA", name_ko="우산"), bbox_x=3),
        Mock(confidence=0.63, object_class=Mock(code="BALL", name_ko="공"), bbox_x=4),
    ]
    event = Mock(
        id=21,
        status="COMPLETED",
        source_type="IMAGE",
        created_at=datetime(2026, 8, 11, 10, 0, tzinfo=UTC),
        detected_objects=objects,
    )
    monkeypatch.setattr("app.services.copilot_tools.list_user_detection_events", lambda *_args, **_kwargs: [event])

    result = execute_tool(Mock(), Mock(role="USER", id=7), "get_my_analysis_results", {})

    payload = result[0]
    assert [item["class_code"] for item in payload["detected_objects"]] == ["BAG", "UMBRELLA", "BALL"]
    assert all("bbox_x" not in item for item in payload["detected_objects"])


@pytest.mark.parametrize(("now", "expected"), [
    (datetime(2026, 8, 10, 23, 0, tzinfo=UTC), datetime(2026, 8, 10, 15, 0, tzinfo=UTC)),  # KST 08:00
    (datetime(2026, 8, 11, 6, 0, tzinfo=UTC), datetime(2026, 8, 10, 15, 0, tzinfo=UTC)),   # KST 15:00
    (datetime(2026, 8, 11, 16, 0, tzinfo=UTC), datetime(2026, 8, 11, 15, 0, tzinfo=UTC)),  # UTC/KST date boundary
])
def test_operations_today_since_uses_kst_midnight(now: datetime, expected: datetime) -> None:
    assert operations_today_since(now) == expected
