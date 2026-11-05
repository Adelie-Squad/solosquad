"""The web's contract — every JSON payload the customer web reads (PRD v2.1.0 I6).

One source: these pydantic models. The endpoints in `app.py` return through them
(`respond`), `solosquad web schema` prints their JSON Schema, and the web generates its
TypeScript types from that file (`web/src/api/types.gen.ts`, `npm run gen:types`). A test
fails when the committed schema differs from the models, so the two languages cannot
drift apart silently (K4 · K11).

Models are closed (`extra="forbid"`) unless a payload is open by design (an approval
card, a graph's state values, an event) — an endpoint that starts sending a field the
contract does not know fails its tests instead of reaching the browser untyped.
"""

from __future__ import annotations

import json
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel, TypeAdapter
from pydantic.json_schema import models_json_schema

Locale = Literal["ko", "en", "zh-CN"]
LOCALES: tuple[str, ...] = ("ko", "en", "zh-CN")
DEFAULT_LOCALE: Locale = "ko"

Role = Literal["owner", "staff"]
TierName = Literal["owner", "team"]


class Closed(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


class Open(BaseModel):
    model_config = ConfigDict(extra="allow", json_schema_serialization_defaults_required=True)


# ---------------------------------------------------------------------- basics · auth


class Ok(Closed):
    ok: bool = True


class Health(Closed):
    ok: bool
    passkeys: bool = False
    """Passkey sign-in is possible here (the office has its `public_url`) — the login
    screen shows the passkey button only then."""


class Version(Closed):
    version: str


class ErrorBody(Closed):
    error: str


class PublicUser(Closed):
    id: str
    username: str
    display: str
    role: Role
    locale: str
    """The person's own choice; empty = follow the org default (`Me.locale` resolves it)."""
    two_factor: bool
    disabled: bool
    title: str
    teams: list[str]


class Me(Closed):
    user: PublicUser | None
    stage: Literal["full", "enroll"]
    csrf: str | None
    """Send back as `X-CSRF-Token` on every state-changing request."""
    local: bool = False
    """The local CLI token (no account) — owner rights on its own machine."""
    locale: Locale = DEFAULT_LOCALE
    """The language the web shows: the person's choice, else the org default (I31)."""
    org_locale: Locale = DEFAULT_LOCALE
    relogin: bool = False
    """A password change ended every session — log in again."""


class TotpBegin(Closed):
    uri: str
    """`otpauth://totp/…` — shown as a QR code for the authenticator app."""


class AccessPolicy(Closed):
    require_login: bool
    two_factor: bool
    allowed_networks: list[str]


class AuditEntry(Closed):
    ts: float
    user_id: str | None
    action: str
    detail: str | None


class WebSettings(Closed):
    """Org-wide web settings (I31) — owner-only to change."""

    locale: Locale = DEFAULT_LOCALE


# ---------------------------------------------------------------------- threads · runs


class TextPart(Closed):
    kind: Literal["text"]
    text: str


class ToolCallPart(Closed):
    kind: Literal["tool_call"]
    id: str
    name: str
    arguments: dict[str, Any]


class ToolResultPart(Closed):
    kind: Literal["tool_result"]
    tool_call_id: str
    content: Any
    is_error: bool


class ChatMessage(Closed):
    id: str
    role: str
    name: str | None
    parts: list[TextPart | ToolCallPart | ToolResultPart]


class Thread(Closed):
    id: str
    title: str | None
    metadata: dict[str, Any]
    created: float
    updated: float


class ThreadCreated(Closed):
    thread_id: str


class RunCreated(Closed):
    run_id: str


class WorkflowRunCreated(Closed):
    thread_id: str
    run_id: str


class ApprovalCard(Open):
    """W12 + decision 51: what is asked, by whom, of which tier."""

    kind: str = "approval"
    title: str
    summary: str = ""
    reason: str = ""
    options: list[str] = Field(default_factory=list)
    risk: str = "high"
    agent: str | None = None
    category: str = "other"
    team: str | None = None
    workflow: str | None = None
    step: str | None = None


class Interrupt(Closed):
    id: str
    value: Any


RunStatusName = Literal["pending", "running", "success", "error", "interrupted", "cancelled"]


class Run(Closed):
    id: str
    thread_id: str
    status: RunStatusName
    kind: str
    input: Any
    error: str | None
    interrupts: list[Interrupt] | None
    created: float
    started: float | None
    ended: float | None
    source: str | None


class ThreadValues(Open):
    messages: list[ChatMessage] = Field(default_factory=list)
    active_agent: str | None = None


class ThreadState(Closed):
    values: ThreadValues
    next: list[str]
    interrupts: list[Interrupt]


class LedgerTotal(Closed):
    calls: int
    tokens: float
    cost_usd: float


class LedgerTotals(RootModel[dict[str, LedgerTotal]]):
    pass


# ---------------------------------------------------------------------- organisation


class Team(Closed):
    name: str
    main: str | None
    members: list[str]


class WorkItem(Closed):
    thread_id: str
    run_id: str
    title: str | None


class Agent(Closed):
    name: str
    description: str
    team: str | None
    layer: str
    appearance: dict[str, Any] | None
    working_on: list[WorkItem]


class AgentCard(Closed):
    name: str
    description: str
    appearance: dict[str, Any] | None


class Person(Closed):
    id: str
    display: str
    title: str
    role: Role


class OrgTeam(Closed):
    name: str
    lead_agent: AgentCard | None
    agents: list[AgentCard]
    people: list[Person]


class OrgChart(Closed):
    owners: list[Person]
    teams: list[OrgTeam]
    unassigned: list[Person]


# ---------------------------------------------------------------------- approvals


class ApprovalItem(Closed):
    source: Literal["company", "workflow"]
    thread_id: str
    run_id: str
    created: float
    card: ApprovalCard
    tier: TierName
    can_approve: bool
    """The server's answer (decision 51) — the web shows buttons only when true."""


class ApprovalPolicyRow(Closed):
    category: str
    label: str
    tier: TierName
    recommended: TierName
    deviates: bool


# ---------------------------------------------------------------------- connections · budget


class Entity(Closed):
    name: str
    country: str
    controlled_by: str | None = None


class ConnectionOut(Closed):
    id: str
    kind: Literal["subscription", "api_key", "local_llm"]
    provider: str
    harness: str
    models: list[str]
    active: bool
    slots: int
    monthly_budget_usd: float | None
    network: str
    entity: Entity | None
    secret_last4: str | None
    eligible: bool
    eligibility_reason: str | None
    eligibility_source: str | None


class BudgetLine(Closed):
    spent_usd: float
    budget_usd: float | None
    remaining_usd: float | None
    warning: bool
    exhausted: bool


class ConnectionBudget(BudgetLine):
    id: str


class Budget(Closed):
    month_start: float
    warn_at: float
    org: BudgetLine
    connections: list[ConnectionBudget]


# ---------------------------------------------------------------------- workflows · artifacts


class WorkflowInput(Closed):
    name: str
    type: Literal["upload", "text", "number"]
    label: str
    accept: list[str]
    required: bool


class WorkflowStepSummary(Closed):
    id: str
    type: Literal["tool", "approval", "agent"]
    title: str


class LastRun(Closed):
    id: str
    status: RunStatusName
    created: float


class WorkflowSummary(Closed):
    name: str
    title: str
    description: str
    schedule: str | None
    team: str | None
    inputs: list[WorkflowInput]
    steps: list[WorkflowStepSummary]
    enabled: bool
    last_run: LastRun | None


class WorkflowList(Closed):
    workflows: list[WorkflowSummary]
    errors: list[str]


class WorkflowValues(Open):
    workflow: str | None = None
    inputs: dict[str, Any] = Field(default_factory=dict)
    step: int = 0
    current_step: str | None = None
    outputs: dict[str, Any] = Field(default_factory=dict)
    artifacts: list[str] = Field(default_factory=list)
    status: str | None = None


class WorkflowThreadState(Closed):
    values: WorkflowValues
    next: list[str]
    interrupts: list[Interrupt]


class Upload(Closed):
    id: str
    filename: str
    size: int
    created: float


class Artifact(Closed):
    id: str
    kind: str
    title: str
    data: dict[str, Any]
    """By kind — `finance.pnl` → `PnlData`, `brief` → `BriefData`."""
    thread_id: str | None
    run_id: str | None
    workflow: str | None
    needs_review: bool
    reviewed_by: str | None
    created: float
    schema_version: int


class PnlAccount(Closed):
    account: str
    type: Literal["revenue", "expense"]
    amount: float


class PnlMonth(Closed):
    month: str
    revenue: float
    expenses: float
    net: float


class PnlReviewRow(Closed):
    row: int
    """The spreadsheet row a person sees (header = 1)."""
    reason: str
    value: str


class PnlData(Closed):
    """`finance.pnl` artifact data — written by `workflows/tools.py finance_pnl`."""

    period: str | None
    currency: str
    revenue: float
    expenses: float
    net_income: float
    by_account: list[PnlAccount]
    by_month: list[PnlMonth]
    needs_review: list[PnlReviewRow]
    rows: int
    summary: str


class BriefData(Open):
    text: str
    agent: str | None = None


ARTIFACT_DATA: dict[str, type[BaseModel]] = {"finance.pnl": PnlData, "brief": BriefData}


# ---------------------------------------------------------------------- passkeys (W3)


class PasskeyOptions(Closed):
    """`navigator.credentials.create()` / `.get()` options (WebAuthn JSON, base64url)."""

    challenge_id: str
    options: dict[str, Any]


class Passkey(Closed):
    id: str
    name: str
    transports: list[str]
    created: float
    last_used: float | None


class PasskeyAdded(Closed):
    ok: bool
    passkeys: list[Passkey]


# ---------------------------------------------------------------------- profile · snapshot


class ProfileServer(Open):
    country: str | None = None
    cloud: str | None = None
    region: str | None = None
    access: str | None = None


class ProfileEntity(Closed):
    id: str
    name: str
    country: str
    controlled_by: str | None = None


class ProfileLanguages(Closed):
    default: Locale
    enabled: list[Locale]


class ProfilePrivacy(Closed):
    regimes: list[str]
    reviewer: str | None = None


class CustomerProfile(Open):
    """`core/profile.yaml` (decision 50) — facts about the customer, no secrets."""

    schema_version: int
    server: ProfileServer
    entities: list[ProfileEntity]
    languages: ProfileLanguages
    privacy: ProfilePrivacy


class ChecklistItem(Closed):
    item: str
    """Stable id — the web names it in the reader's language."""
    label: str
    done: bool


class ProfileResponse(Closed):
    profile: CustomerProfile
    checklist: list[ChecklistItem]


class SnapshotSettings(Closed):
    """`workspace.yaml snapshot` — the keys themselves are never sent, only whether
    they are stored."""

    type: Literal["s3", "dir"] | None
    endpoint: str | None
    region: str
    bucket: str | None
    prefix: str
    path: str | None
    keep_days: int
    has_secret: bool


class SnapshotRunResult(Open):
    target: Literal["s3", "dir"] | None = None
    location: str | None = None
    files: int | None = None
    pruned: list[str] = Field(default_factory=list)
    skipped: str | None = None


# ---------------------------------------------------------------------- screens (I30)


class WidgetSpec(Open):
    """One widget on a declarative screen: `widget` id + its props (I30)."""

    widget: str
    version: int = 1


class Screen(Closed):
    """`orgs/<org>/screens/<name>.yaml` — format 1."""

    format_version: int
    title: str | None = None
    """Shown as written (customer content, not translated); empty = the web's own name."""
    widgets: list[WidgetSpec] = Field(default_factory=list)


class ScreenResponse(Closed):
    name: str
    source: Literal["org", "default"]
    screen: Screen | None
    error: str | None = None
    """Set when the file could not be read — the web shows a placeholder, never crashes."""


# ---------------------------------------------------------------------- events (I9)


class EngineEvent(Open):
    """One server-sent event (`data:`); `id:` carries the replay sequence (Last-Event-ID)."""

    model_config = ConfigDict(extra="allow", json_schema_serialization_defaults_required=False)

    ts: float
    event: Literal[
        "run.created",
        "run.started",
        "run.message",
        "run.update",
        "run.interrupted",
        "run.completed",
        "run.failed",
        "escalation",
    ]
    source: Literal["company", "workflow"] | None = None
    run_id: str | None = None
    thread_id: str | None = None
    agent: str | None = None
    text: str | None = None
    node: str | None = None
    summary: Any = None
    error: str | None = None
    interrupts: list[Interrupt] | None = None


# ---------------------------------------------------------------------- export · respond

EXPORTED: tuple[type[BaseModel], ...] = (
    Ok,
    Health,
    Version,
    ErrorBody,
    PublicUser,
    Me,
    TotpBegin,
    AccessPolicy,
    AuditEntry,
    WebSettings,
    ChatMessage,
    Thread,
    ThreadCreated,
    RunCreated,
    WorkflowRunCreated,
    ApprovalCard,
    Interrupt,
    Run,
    ThreadState,
    LedgerTotals,
    Team,
    Agent,
    OrgChart,
    ApprovalItem,
    ApprovalPolicyRow,
    Entity,
    ConnectionOut,
    Budget,
    WorkflowList,
    WorkflowThreadState,
    Upload,
    Artifact,
    PnlData,
    BriefData,
    Screen,
    ScreenResponse,
    EngineEvent,
    PasskeyOptions,
    Passkey,
    PasskeyAdded,
    CustomerProfile,
    ProfileResponse,
    SnapshotSettings,
    SnapshotRunResult,
)


def json_schema() -> dict[str, Any]:
    """One JSON Schema document: every exported model under `$defs`, referenced from the root
    so a generator emits each one as a named type."""
    _, top = models_json_schema(
        [(m, "serialization") for m in EXPORTED], ref_template="#/$defs/{model}"
    )
    defs = {
        name: {**_untitled(d), "title": d.get("title", name)} for name, d in top["$defs"].items()
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "SoloSquadWebApi",
        "description": "Generated by `solosquad web schema` — do not edit.",
        "type": "object",
        "properties": {m.__name__: {"$ref": f"#/$defs/{m.__name__}"} for m in EXPORTED},
        "required": [m.__name__ for m in EXPORTED],
        "additionalProperties": False,
        "$defs": dict(sorted(defs.items())),
    }


def _untitled(node: Any) -> Any:
    """Drop per-field `title`s — a generator would turn each into a type alias that can
    collide with a model's name (`Agent` the field vs `Agent` the model)."""
    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for k, v in node.items():
            if k in ("properties", "$defs"):  # keys here are names, not keywords
                out[k] = {name: _untitled(sub) for name, sub in v.items()}
            elif k != "title":
                out[k] = _untitled(v)
        return out
    if isinstance(node, list):
        return [_untitled(v) for v in node]
    return node


def schema_text() -> str:
    return json.dumps(json_schema(), indent=2, ensure_ascii=False, sort_keys=False) + "\n"


_adapters: dict[Any, TypeAdapter[Any]] = {}


def adapter(tp: Any) -> TypeAdapter[Any]:
    found = _adapters.get(tp)
    if found is None:
        found = _adapters[tp] = TypeAdapter(tp)
    return found


def conform(tp: Any, data: Any) -> Any:
    """Validate `data` (already JSON-shaped) against `tp` → the JSON value to send."""
    a = adapter(tp)
    return a.dump_python(a.validate_python(data), mode="json")
