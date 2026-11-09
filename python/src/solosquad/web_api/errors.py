"""Every error the web API answers with, in one list (PRD v2.1.0 §7 ⓖ · DESIGN.md `## 문구`).

An error body is `{"error": <English sentence>, "code": <ErrorCode>, "params": {...}}`:

- `error` is for logs and developers — it may change wording at any time;
- `code` is the contract: the web turns it into the person's language (`error.<code>`
  keys in ko · en · zh-CN), filling `params` into the text's placeholders;
- a code the web does not know reads as a generic sentence, never as the English one.

A scope that is not yours and a scope that does not exist answer the same 404 with the same
code (`not_found`) — the code must never tell them apart (C3 · C30).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from starlette.exceptions import HTTPException

Param = str | int | float


class ErrorCode(StrEnum):
    # -- generic: what a status means when nothing more precise applies
    INVALID_REQUEST = "invalid_request"
    UNAUTHORIZED = "unauthorized"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    METHOD_NOT_ALLOWED = "method_not_allowed"
    CONFLICT = "conflict"
    TOO_LARGE = "too_large"
    UNPROCESSABLE = "unprocessable"
    SERVER_ERROR = "server_error"
    # -- the gate (app.py docstring, steps 1 to 6)
    NETWORK_BLOCKED = "network_blocked"
    WORKSPACE_NETWORK_BLOCKED = "workspace_network_blocked"
    CSRF_INVALID = "csrf_invalid"
    ENROL_REQUIRED = "enrol_required"
    ROLE_FORBIDDEN = "role_forbidden"
    WORKSPACE_NOT_STARTED = "workspace_not_started"
    ORG_NOT_RUNNING = "org_not_running"
    ORG_RECORDS_UNAVAILABLE = "org_records_unavailable"
    FEATURE_DISABLED = "feature_disabled"
    # -- sign-in · second factor · passkeys
    LOGIN_FAILED = "login_failed"
    LOGIN_THROTTLED = "login_throttled"
    OTP_REQUIRED = "otp_required"
    OTP_INVALID = "otp_invalid"
    OTP_CURRENT_REQUIRED = "otp_current_required"
    ACCOUNT_REQUIRED = "account_required"
    PASSKEYS_UNAVAILABLE = "passkeys_unavailable"
    PASSKEY_EXPIRED = "passkey_expired"
    PASSKEY_REJECTED = "passkey_rejected"
    PASSKEY_NOT_RECOGNISED = "passkey_not_recognised"
    # -- people · assignments · own settings
    USERNAME_INVALID = "username_invalid"
    USERNAME_TAKEN = "username_taken"
    PASSWORD_TOO_SHORT = "password_too_short"
    LAST_OWNER = "last_owner"
    ASSIGNMENT_INVALID = "assignment_invalid"
    ASSIGNMENT_DUPLICATE = "assignment_duplicate"
    ASSIGNMENT_UNKNOWN_SCOPE = "assignment_unknown_scope"
    USER_FIELDS_MOVED = "user_fields_moved"
    TEAMS_INVALID = "teams_invalid"
    LOCALE_INVALID = "locale_invalid"
    # -- access policy
    ACCESS_LOCKOUT = "access_lockout"
    NETWORK_INVALID = "network_invalid"
    # -- profile · snapshot
    PROFILE_INVALID = "profile_invalid"
    SNAPSHOT_INVALID = "snapshot_invalid"
    SNAPSHOT_KEYS_REQUIRED = "snapshot_keys_required"
    SNAPSHOT_UNAVAILABLE = "snapshot_unavailable"
    SNAPSHOT_FAILED = "snapshot_failed"
    SECRET_STORE_MISSING = "secret_store_missing"
    # -- approvals
    APPROVAL_POLICY_INVALID = "approval_policy_invalid"
    UNCLASSIFIED_OWNER_ONLY = "unclassified_owner_only"
    APPROVAL_NEEDS_OWNER = "approval_needs_owner"
    APPROVAL_NEEDS_TEAM = "approval_needs_team"
    # -- connections
    CONNECTION_ID_REQUIRED = "connection_id_required"
    CONNECTION_EXISTS = "connection_exists"
    ENTITY_REQUIRED = "entity_required"
    CONNECTION_INELIGIBLE_ENTITY = "connection_ineligible_entity"
    CONNECTION_INELIGIBLE_SERVER = "connection_ineligible_server"
    # -- workflows · uploads
    WORKFLOW_INPUT_INVALID = "workflow_input_invalid"
    UPLOAD_TYPE = "upload_type"
    UPLOAD_EMPTY = "upload_empty"
    UPLOAD_TOO_LARGE = "upload_too_large"
    # -- calendar (decision 60)
    CALENDAR_TITLE_REQUIRED = "calendar_title_required"
    CALENDAR_DATE_INVALID = "calendar_date_invalid"
    CALENDAR_KIND_INVALID = "calendar_kind_invalid"
    CALENDAR_ORG_REQUIRED = "calendar_org_required"
    CALENDAR_PARENT_INVALID = "calendar_parent_invalid"
    CALENDAR_STATUS_INVALID = "calendar_status_invalid"
    CALENDAR_LABEL_INVALID = "calendar_label_invalid"
    CALENDAR_LABEL_EXISTS = "calendar_label_exists"
    CALENDAR_COLOR_INVALID = "calendar_color_invalid"
    CALENDAR_ASSIGNEE_INVALID = "calendar_assignee_invalid"
    CALENDAR_REORDER_INVALID = "calendar_reorder_invalid"
    CALENDAR_AGENT_ACCESS_INVALID = "calendar_agent_access_invalid"
    # -- the dashboard digest (자리를 비운 동안)
    DIGEST_SINCE_INVALID = "digest_since_invalid"
    DIGEST_UNTIL_INVALID = "digest_until_invalid"


BY_STATUS: dict[int, ErrorCode] = {
    400: ErrorCode.INVALID_REQUEST,
    401: ErrorCode.UNAUTHORIZED,
    403: ErrorCode.FORBIDDEN,
    404: ErrorCode.NOT_FOUND,
    405: ErrorCode.METHOD_NOT_ALLOWED,
    409: ErrorCode.CONFLICT,
    413: ErrorCode.TOO_LARGE,
    422: ErrorCode.UNPROCESSABLE,
}
"""For an error raised without a code (Starlette's own 404 · 405, a stray `ValueError`)."""


def for_status(status: int) -> ErrorCode:
    return BY_STATUS.get(status, ErrorCode.SERVER_ERROR)


class ApiError(HTTPException):
    """The only HTTP error the web API raises — a test fails on a bare `HTTPException`."""

    def __init__(self, status: int, code: ErrorCode, message: str, **params: Param) -> None:
        super().__init__(status, message)
        self.code = code
        self.params = params


class CodedError(ValueError):
    """A validation error from a store the CLI shares (accounts): still a `ValueError` for
    the CLI, a coded 400 for the web."""

    def __init__(self, code: ErrorCode, message: str, **params: Param) -> None:
        super().__init__(message)
        self.code = code
        self.params = params


def body(message: str, code: ErrorCode, params: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": message, "code": code.value, "params": dict(params or {})}
