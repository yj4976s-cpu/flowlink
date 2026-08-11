from datetime import UTC, datetime
from unittest.mock import Mock

from app.services.copilot_tools import execute_tool, tool_definitions


def test_guest_has_no_personal_or_admin_tools() -> None:
    assert tool_definitions(None) == []


def test_user_and_admin_receive_different_tool_sets() -> None:
    user_names = {item["name"] for item in tool_definitions("USER")}
    admin_names = {item["name"] for item in tool_definitions("ADMIN")}
    assert "get_my_matches" in user_names
    assert {"get_my_analysis_results", "get_my_ownership_claims"}.issubset(user_names)
    assert "get_operations_summary" not in user_names
    assert admin_names == {"get_operations_summary"}


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
