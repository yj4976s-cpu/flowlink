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
