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

from solosquad.web_api.errors import ErrorCode

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
    """Every error answer (`web_api/errors.py`). The web shows `code` in the person's language
    (`error.<code>`, `params` in its placeholders) — never `error`, which is for logs."""

    error: str
    code: ErrorCode
    params: dict[str, str | int | float] = Field(default_factory=dict)


class AssignmentOut(Closed):
    """One row of the assignment table (I39): `workspace` null = the whole org."""

    org: str
    workspace: str | None
    role: Role


class PublicUser(Closed):
    id: str
    username: str
    display: str
    role: Role
    """The customer-level role: `owner` = the customer's owner, owner of every org;
    `staff` = only what `assignments` give (decision 57 ⑵)."""
    locale: Locale = DEFAULT_LOCALE
    """The person's own screen language (2026-11-11 — no customer default; ko until they
    choose)."""
    two_factor: bool
    disabled: bool
    title: str = ""
    """Deprecated since rev7 — always empty. A title is per org: `OrgPerson.title`."""
    teams: list[str] = Field(default_factory=list)
    """Deprecated since rev7 — always empty. Teams are per org: `OrgPerson.teams`."""
    assignments: list[AssignmentOut] = Field(default_factory=list)


class ScopeWorkspace(Closed):
    name: str
    display: str = ""
    """The name people read — `workspace.yaml` `display_name`, else the id (the web then
    makes the id readable)."""
    role: Role
    """The person's role there — `can_approve` and the role table follow it."""
    running: bool = True
    """False when the workspace is placed on this server but its runtime did not start."""


class ScopeOrg(Closed):
    """An org the person may open, with the workspaces of it they may open (I40)."""

    org: str
    display: str
    """The name people read — `org.yaml` `display_name`, else the id (the web then makes
    the id readable)."""
    role: Role
    """The role at org scope (org chart · approval policy · connections · workflows)."""
    whole_org: bool
    """Assigned the whole org (every workspace of it, now and later) — false = only the
    listed workspaces."""
    workspaces: list[ScopeWorkspace]


class ScopeRef(Closed):
    org: str
    workspace: str


class DemoInfo(Closed):
    """The demo account signed in, and what the demo server locks (PRD §3.6.4 ③)."""

    id: str
    """e.g. `samsungDemo`."""
    label: str
    expires: float
    locked: list[str]
    """The lock table — route keys refused with `demo_read_only` (and a few own-account
    actions); the web locks the same controls."""
    contact_url: str | None
    """상담 요청 — the demo band's link to the agency."""
    suggestions: list[str]
    """The suggested requests; each runs its scenario."""


class DemoRestarted(Closed):
    workflows: list[str]
    """The scenario workflows started again."""


class Me(Closed):
    user: PublicUser | None
    stage: Literal["full", "enroll"]
    csrf: str | None
    """Send back as `X-CSRF-Token` on every state-changing request."""
    local: bool = False
    """The local CLI token (no account) — owner rights on its own machine."""
    locale: Locale = DEFAULT_LOCALE
    """The language the web shows: the person's own (`PublicUser.locale`); ko when there
    is no account (the local token, a finished session)."""
    relogin: bool = False
    """A password change ended every session — log in again."""
    scopes: list[ScopeOrg] = Field(default_factory=list)
    """What this person may open, org → workspaces (I40) — the switcher lists exactly this;
    anything else answers 404."""
    last_scope: ScopeRef | None = None
    """Where to open after login: the last workspace this person used, or their first one
    when that is gone or they never used one; null = nothing assigned."""
    demo: bool = False
    """A demo server (decision 62): settings are read-only, the web shows the 데모 chip and
    posts screen changes (`POST /api/demo/events`). Decided by the server, never the web."""
    demo_info: DemoInfo | None = None
    """The demo account signed in — its id, expiry and the lock table."""


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
    workspace: str | None = None
    """In an org's audit: the workspace the action was in (null = the org itself)."""


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
    category: str = "unclassified"
    team: str | None = None
    workflow: str | None = None
    step: str | None = None


class Interrupt(Closed):
    id: str
    value: Any


RunStatusName = Literal[
    "pending", "running", "success", "error", "interrupted", "cancelled", "superseded"
]


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
    superseded_by: str | None = None
    """The newer run on the thread that answered this interrupted one (status `superseded`)."""


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
    """Decision 58: a team is its members — no lead agent."""

    name: str
    members: list[str]


class WorkItem(Closed):
    thread_id: str
    run_id: str
    title: str | None


Localized = dict[str, str]
"""Words for people, by language (`ko` · `en` · `zh-CN`) — from the agent's SKILL.md."""


class Agent(Closed):
    name: str
    description: str
    """For routing and other agents (English). People read `summary`."""
    display_name: Localized = Field(default_factory=dict)
    """The name people read, per language; empty = the web makes the id readable."""
    summary: Localized = Field(default_factory=dict)
    """What the agent does, in two or three plain sentences, per language."""
    team: str | None
    layer: str
    appearance: dict[str, Any] | None
    working_on: list[WorkItem]


class AgentCard(Closed):
    name: str
    description: str
    display_name: Localized = Field(default_factory=dict)
    summary: Localized = Field(default_factory=dict)
    appearance: dict[str, Any] | None


class Person(Closed):
    id: str
    display: str
    title: str
    role: Role


class OrgPerson(Closed):
    """A person as this org knows them (`/api/o/{org}/people`): role, title and teams here."""

    id: str
    username: str
    display: str
    role: Role
    title: str
    teams: list[str]
    workspaces: list[str] | None
    """null = the whole org; else only these workspaces of it."""


class OrgTeam(Closed):
    name: str
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
    secret_last4: str | None
    eligible: bool
    eligibility_reason: str | None
    eligibility_source: str | None
    source: Literal["core", "org"] = "core"
    """`core` = the customer's shared connection (read-only here); `org` = this org's own,
    editable at org scope."""


class BudgetLine(Closed):
    spent_usd: float
    budget_usd: float | None
    remaining_usd: float | None
    warning: bool
    exhausted: bool


class ConnectionBudget(BudgetLine):
    id: str


class BudgetSuggestion(Closed):
    """What Chief suggests next to a warning (C9) — shown, never applied by itself."""

    kind: Literal["switch_connection", "raise_budget"]
    subject: str | None
    """The connection over its warning line; `None` = the company line."""
    to_connection: str | None
    """`switch_connection`: the connection with room to move the work to."""
    budget_usd: float | None
    """`raise_budget`: the proposed monthly cap (this month's pace, back under the line)."""


class Budget(Closed):
    month_start: float
    warn_at: float
    org: BudgetLine
    connections: list[ConnectionBudget]
    suggestions: list[BudgetSuggestion]


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


class ScheduleEntry(Closed):
    """One scheduled run of the workspace (2026-11-07 — the scheduler joined the workflows)."""

    id: str
    """`wf:<workflow>` or `cron:<file stem>` — the scheduler's own job id."""
    kind: Literal["workflow", "goal", "routine"]
    """`goal` = a standing-goal cron (one fixed thread); `routine` = a cron that starts a new
    thread each time; `workflow` = a workflow's `schedule:`."""
    name: str
    title: str
    schedule: str
    """Five-field crontab in the list's `timezone`; the web turns it into a sentence."""
    enabled: bool
    next_run: float | None
    """When it fires next — None when switched off or the crontab does not parse."""
    last_run: LastRun | None
    workflow: str | None
    """Switched with `PATCH /api/o/{org}/workflows/{workflow}` (owner); None = set in its file."""


class ScheduleList(Closed):
    timezone: str
    schedules: list[ScheduleEntry]
    errors: list[str]


class WorkArtifact(Closed):
    id: str
    kind: str
    title: str
    needs_review: bool


class WorkEntry(Closed):
    """One piece of agent work for Task — a conversation or a workflow run, by its newest run."""

    source: Literal["chat", "workflow"]
    thread_id: str
    run_id: str
    title: str | None
    workflow: str | None
    cron: str | None
    """The cron that started it (a scheduled run), else None."""
    status: RunStatusName
    created: float
    ended: float | None
    agents: list[str]
    """Who worked on it, first to last (from the cost ledger)."""
    step: int | None
    """A workflow run that is not finished: the index of the step it is on."""
    steps: int | None
    current_step: str | None
    artifacts: list[WorkArtifact]


class WorkList(Closed):
    items: list[WorkEntry]


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


# The demo's org-package kinds (decision 62) — `demo/scenario.py` writes them; the same kinds
# serve a real commerce org package later (W11 · v2.2.0).


class PayableItem(Closed):
    vendor: str
    invoice: str
    item: str
    due: str
    amount: float


class PayablesData(Open):
    """`finance.payables` — the payments waiting for the owner's 대표 승인."""

    items: list[PayableItem]
    total: float
    total_text: str
    account: str
    pay_on: str
    summary: str


class SupplierRow(Closed):
    supplier: str
    region: str
    unit_price_cny: float
    shipping: float
    duty_rate: float
    landed_krw: float
    """Unit price in KRW + shipping + duty — the cost compared."""
    moq: int
    lead_days: int
    defect_rate: float
    note: str
    score: float
    recommended: bool


class SupplierComparisonData(Open):
    """`sourcing.comparison`."""

    product: str
    retail_price: float
    suppliers: list[SupplierRow]
    recommended: str | None
    summary: str


class PoLine(Closed):
    sku: str
    name: str
    name_local: str
    """The product name in the supplier's language."""
    qty: int
    unit_price: float
    amount: float


class PurchaseOrderData(Open):
    """`sourcing.po` — a draft; nothing is sent."""

    supplier: str
    language: str
    """The language the draft is written in for the supplier (zh-CN)."""
    title_local: str
    po_number: str
    currency: str
    lines: list[PoLine]
    subtotal: float
    total: float
    total_text: str
    delivery: str
    terms_local: str
    summary: str


class SnsCalendarEntry(Closed):
    date: str
    channel: str
    language: str
    theme: str
    format: str
    owner: str


class SnsReaction(Closed):
    post: str
    channel: str
    reach: int
    likes: int
    comments: int
    saves: int


class SnsCalendarData(Open):
    """`sns.calendar`."""

    week: str
    entries: list[SnsCalendarEntry]
    last_week: list[SnsReaction]
    summary: str


class SnsPost(Closed):
    channel: str
    date: str
    language: str
    caption: str
    hashtags: list[str]
    image_note: str


class SnsPostsData(Open):
    """`sns.posts` — drafts; nothing is posted."""

    posts: list[SnsPost]
    summary: str


class AdPlanData(Open):
    """`sns.ads` — the ad plan waiting for the owner's 대표 승인."""

    channel: str
    budget: float
    budget_text: str
    days: int
    start: str
    audience: str
    expected_reach: str
    creative: str
    summary: str


ARTIFACT_DATA: dict[str, type[BaseModel]] = {
    "finance.pnl": PnlData,
    "brief": BriefData,
    "finance.payables": PayablesData,
    "sourcing.comparison": SupplierComparisonData,
    "sourcing.po": PurchaseOrderData,
    "sns.calendar": SnsCalendarData,
    "sns.posts": SnsPostsData,
    "sns.ads": AdPlanData,
}


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


# ---------------------------------------------------------------------- 서버 · 회사 · snapshot


class ServerFacts(Closed):
    """What this engine server is (the 서버 tab, read-only) — detected, with the builder's
    `core/server.yaml` values as overrides (`solosquad.server_facts`)."""

    where: Literal["local", "intranet", "cloud"]
    """`local` = this computer (the web says 로컬)."""
    cloud: str | None
    region: str | None
    country: str | None
    """ISO country — the server half of decision 45's region rule; null = unknown."""
    os: str
    version: str
    """The engine's version."""
    sources: dict[str, Literal["override", "detected", "default"]]


class Company(Closed):
    """The customer company (회사, 2026-11-11) — `core.db` table `company`. The account
    holder for decision 45: its 소재지 country (and a 법인's 지배 회사 나라)."""

    kind: Literal["corporation", "sole_proprietor"] | None
    """법인 · 개인 사업자."""
    name: str
    """법인명 or 상호."""
    representative: str
    """대표자."""
    country: str | None
    """소재지 country, ISO 3166-1 alpha-2."""
    address: str
    """소재지 address lines."""
    controlled_by: str | None
    """지배 회사 나라 (법인 only) — the controlling company's HQ country, if different."""
    complete: bool


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


# ---------------------------------------------------------------------- calendar (decision 60)

CalendarKind = Literal["work", "personal"]
CalendarStatus = Literal["planned", "active", "done", "canceled"]
CalendarColor = Literal["blue", "teal", "green", "gold", "orange", "rose", "gray"]


class CalendarItem(Closed):
    """A 항목 (`parent_id` null) or a 세부 항목 (one level below). `start`/`end` are a date
    (`2026-11-20`, all day) or a local date-time (`2026-11-20T14:00`) — never a timestamp,
    so a day stays the day it was written on."""

    id: str
    kind: CalendarKind
    org: str | None
    """Work: the business (org) it belongs to. Personal: null."""
    workspace: str | None
    owner_id: str | None
    """Personal: the one person who sees it. Work: null."""
    parent_id: str | None
    title: str
    notes: str
    start: str | None
    end: str | None
    all_day: bool
    category_id: str | None
    """구분 — one `CalendarLabel` of type `category` from the same scope."""
    tag_ids: list[str]
    status: CalendarStatus
    position: int
    created_by: str | None
    created: float
    updated: float


class CalendarTodo(Closed):
    """A 할 일 under a 항목 or 세부 항목. One with `due` shows on the calendar that day."""

    id: str
    item_id: str
    title: str
    done: bool
    due: str | None
    assignee_id: str | None
    position: int
    created: float
    updated: float


class CalendarList(Closed):
    """`GET /api/calendar/items?from=&to=` — what overlaps those days (inclusive)."""

    start: str
    end: str
    items: list[CalendarItem]
    todos: list[CalendarTodo]
    """To-dos due in the range (their item may be outside it — see `context`)."""
    context: list[CalendarItem]
    """Parents of listed sub-items and items of listed to-dos that are not in `items` —
    for breadcrumbs and colours, not to be drawn as entries."""


class CalendarDetail(Closed):
    item: CalendarItem
    parent: CalendarItem | None
    children: list[CalendarItem]
    todos: list[CalendarTodo]
    child_todos: list[CalendarTodo]
    """The to-dos of the sub-items, for their counts in the drawer."""


class CalendarTodoOut(Closed):
    todo: CalendarTodo
    item: CalendarItem


class CalendarLabel(Closed):
    """구분 (`category`) or 태그 (`tag`) — per org (`scope_kind` org) for work entries, per
    person (`user`) for personal ones."""

    id: str
    type: Literal["category", "tag"]
    scope_kind: Literal["org", "user"]
    scope: str
    name: str
    color: CalendarColor
    archived: bool
    position: int


class CalendarLabels(Closed):
    labels: list[CalendarLabel]
    seeded: dict[str, str] = Field(default_factory=dict)
    """Scopes seeded by this call → from where (`default` · `calendar/presets.yaml`)."""
    preset_errors: dict[str, str] = Field(default_factory=dict)
    """org → why its preset file could not be used (the default was seeded instead)."""


AgentAccessLevel = Literal["off", "busy", "full"]


class CalendarAgentAccess(Closed):
    """How much agents may read of this person's personal entries (decision 60 rev):
    `off` (default) nothing · `busy` time blocks only · `full` titles, times and notes."""

    level: AgentAccessLevel


class AgentBlock(Closed):
    """One personal entry as an agent may read it. At `busy` only the times are set."""

    start: str | None
    end: str | None
    all_day: bool
    id: str | None
    title: str | None
    notes: str | None
    status: CalendarStatus | None


class CalendarAgentView(Closed):
    """`GET /api/calendar/agent-view` — the read path for an agent tool (v2.2)."""

    user_id: str
    level: AgentAccessLevel
    start: str
    end: str
    entries: list[AgentBlock]


class CalendarEvent(Closed):
    """One `GET /api/calendar/events` message — "something changed, refetch". Carries ids
    only, and reaches only people who may see the entry (a personal one: its owner)."""

    ts: float
    event: Literal["calendar.changed", "calendar.labels"]
    kind: CalendarKind | None = None
    org: str | None = None
    workspace: str | None = None
    item_id: str | None = None


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


# ------------------------------------------------------------------ the digest (자리를 비운 동안)

DigestBasis = Literal["first", "away", "acknowledged"]


class DigestWork(Closed):
    """A conversation or workflow run that ended in the window (by its newest run)."""

    org: str
    workspace: str
    source: Literal["chat", "workflow"]
    thread_id: str
    run_id: str
    title: str | None
    workflow: str | None
    cron: str | None
    status: RunStatusName
    ended: float
    agents: list[str]
    artifacts: list[WorkArtifact]
    """What it made in the window."""
    error: str | None


class DigestApproval(Closed):
    """An approval that arrived in the window and still waits — `ApprovalItem` plus where."""

    org: str
    workspace: str
    source: Literal["company", "workflow"]
    thread_id: str
    run_id: str
    created: float
    card: ApprovalCard
    tier: TierName
    can_approve: bool


class DigestDecision(Closed):
    """An approval someone else answered in the window."""

    org: str
    workspace: str
    ts: float
    approver: str
    """Their display name."""
    decision: Literal["approved", "declined", "other"]
    source: Literal["company", "workflow"]
    thread_id: str
    title: str | None
    category: str | None


class DigestScheduled(Closed):
    """A run a schedule started in the window (a failed one is under `failed` instead)."""

    org: str
    workspace: str
    run_id: str
    thread_id: str
    kind: Literal["workflow", "cron"]
    name: str
    title: str
    status: RunStatusName
    created: float
    artifacts: list[WorkArtifact]


class DigestCalendar(Closed):
    """A 일정 item that began, or a 할 일 that came due, in the window (not done)."""

    type: Literal["item", "todo"]
    id: str
    item_id: str
    title: str
    item_title: str | None
    """For a to-do: the item it belongs to."""
    when: str
    kind: CalendarKind
    org: str | None


class DigestOrgCost(Closed):
    org: str
    display: str
    spent_usd: float


class DigestCost(Closed):
    spent_usd: float
    orgs: list[DigestOrgCost]


class DigestCounts(Closed):
    """How many of each there were — the lists are capped, these are not."""

    finished: int
    failed: int
    approvals_mine: int
    approvals_others: int
    decided: int
    scheduled: int
    calendar: int


class Digest(Closed):
    """`GET /api/me/digest` — what happened in the person's scopes between `since` (when they
    were last here) and `until` (now). Deterministic aggregation, no model call."""

    basis: DigestBasis
    """first = never here before (no window) · away = since the end of the previous visit ·
    acknowledged = since they last said 확인했어요."""
    since: float | None
    until: float
    finished: list[DigestWork]
    failed: list[DigestWork]
    approvals_mine: list[DigestApproval]
    approvals_others: list[DigestApproval]
    decided: list[DigestDecision]
    scheduled: list[DigestScheduled]
    calendar: list[DigestCalendar]
    cost: DigestCost
    counts: DigestCounts
    cap: int
    """The most rows any one list carries."""


class DigestAck(Closed):
    """`POST /api/me/digest/ack` — the digest now starts here."""

    seen_until: float
    basis: DigestBasis


# ---------------------------------------------------------------------- export · respond

EXPORTED: tuple[type[BaseModel], ...] = (
    Ok,
    Health,
    Version,
    ErrorBody,
    AssignmentOut,
    PublicUser,
    ScopeWorkspace,
    ScopeOrg,
    ScopeRef,
    DemoInfo,
    Me,
    DemoRestarted,
    TotpBegin,
    AccessPolicy,
    AuditEntry,
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
    OrgPerson,
    ApprovalItem,
    ApprovalPolicyRow,
    ConnectionOut,
    Budget,
    WorkflowList,
    WorkflowThreadState,
    ScheduleList,
    WorkList,
    Upload,
    Artifact,
    PnlData,
    BriefData,
    PayablesData,
    SupplierComparisonData,
    PurchaseOrderData,
    SnsCalendarData,
    SnsPostsData,
    AdPlanData,
    Screen,
    ScreenResponse,
    EngineEvent,
    PasskeyOptions,
    Passkey,
    PasskeyAdded,
    ServerFacts,
    Company,
    SnapshotSettings,
    SnapshotRunResult,
    CalendarItem,
    CalendarTodo,
    CalendarList,
    CalendarDetail,
    CalendarTodoOut,
    CalendarLabel,
    CalendarLabels,
    CalendarEvent,
    CalendarAgentAccess,
    CalendarAgentView,
    Digest,
    DigestAck,
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
