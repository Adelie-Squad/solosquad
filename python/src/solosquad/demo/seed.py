"""Make a demo server, and a visitor's fresh copy of the example company on it.

    demo init <dir>          the solution: `server.yaml` `mode: demo`, the fictional 회사
                             모아 리빙, an empty connection pool, no second factor
    issue → seed_account     the visitor's org `<demoid>`: the template (workflows · artifact
                             kinds · knowledge · sample files), two example people, calendar
                             entries, past runs and work products (the scenarios played once,
                             yesterday), and where the dashboard digest starts
    reset → wipe_org + seed  the same, fresh (처음 상태로 · nightly) — usage rows stay

The template is `solosquad/demo/template/` (copied into the solution as `demo/template/` at
init, so a builder can adjust the example data per server without touching the engine).
"""

from __future__ import annotations

import datetime as dt
import gc
import json
import secrets
import shutil
import sqlite3
import string
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from solosquad import __version__
from solosquad.calendars import CalendarStore, Viewer, seed_demo
from solosquad.company_info import Company
from solosquad.demo import (
    ORG_WORKSPACE,
    DemoConfig,
    check_id,
    load_config,
    normalize_company_no,
    org_for,
    save_config,
)
from solosquad.demo.harness import DemoHarness
from solosquad.demo.i18n import L, Lang, known, pick, read_locale, write_locale
from solosquad.demo.scenario import SCENARIOS, Pace, register_tools, run_through, set_pace
from solosquad.demo.store import DemoAccount, DemoStore
from solosquad.instance import Instance, build_instance, start_instance, stop_instance
from solosquad.layout import (
    AccessPolicy,
    EngineStore,
    ExecutionPolicy,
    Solution,
    scaffold_org,
    scaffold_solution,
    scaffold_workspace,
    solosquad_home,
)
from solosquad.routing.connections import Connection, ConnectionKind
from solosquad.storage import OFFICE_DB, ORG_DB, close_under, connect
from solosquad.web_api.accounts import AccountStore, Assignment, Role
from solosquad.web_api.org_store import open_accounts, open_org

TEMPLATE = Path(__file__).resolve().parent / "template"
COMPANY = Company(
    kind="corporation",
    name="모아 리빙 주식회사 (예시 회사)",
    representative="홍길동 (예시)",
    country="KR",
    address="경기도 광주시 오포읍 물류로 00 (예시 주소)",
)
ORG_DISPLAY = L("모아 리빙 (예시)", "Moa Living (example)", "Moa Living（示例）")
WS_DISPLAY = L("본사", "HQ", "总部")
SCRIPTED = Connection(
    id="demo-scripted",
    kind=ConnectionKind.LOCAL_LLM,
    provider="local",
    harness="lite",
    models=["scripted"],
    base_url="http://127.0.0.1:9/v1",  # discard port — even a missed override goes nowhere
    slots=8,
    network="local",
)
"""The one connection of a demo runtime — in memory only, so the pool on disk stays empty
(PRD §3.6.4 ②) and the 연결 settings show nothing to add or toggle."""
MEMBERS = (
    # (username suffix, display, title, teams) — made-up names, never able to sign in
    ("finance", L("김재무 (예시 인물)", "Jaemu Kim (example person)", "金财务（示例人物）"),
     L("재무 담당", "Finance", "财务"), ["business"]),
    ("marketing", L("이마케 (예시 인물)", "Make Lee (example person)", "李营销（示例人物）"),
     L("마케팅 담당", "Marketing", "营销"), ["brand"]),
)  # fmt: skip
OWNER_TITLE = L("대표 (데모)", "Owner (demo)", "代表（演示）")
QUESTION = (
    L(
        "어제 B2B 납품 매출 어땠어?",
        "How were yesterday's B2B sales?",
        "昨天的 B2B 供货销售怎么样？",
    ),
    L(
        "어제 B2B 납품 매출 어땠어? 손익 기준으로 알려줘.",
        "How were yesterday's B2B sales? Tell me in P&L terms.",
        "昨天的 B2B 供货销售怎么样？按损益告诉我。",
    ),
)
"""The example conversation of yesterday — (title, the request)."""
CALENDAR = (
    # (title, from day, to day, notes)
    (L("11월 정기 발주 마감", "November regular orders close", "11月定期订货截止"), 2, 2,
     L("B2B 거래처 정기 발주를 마감해요. (예시)", "The B2B customers' regular orders close. "
       "(example)", "B2B 客户的定期订货截止。（示例）")),
    (L("부가세 예정 신고 준비", "Prepare the VAT preliminary return", "准备增值税预缴申报"), 4, 9,
     L("10월 손익표가 확정되면 자료를 묶어요.", "Once the October P&L is final, gather the "
       "records.", "10月损益表定稿后整理资料。")),
    (L("겨울 텀블러 신상품 출시", "Winter tumbler launch", "冬季保温杯新品上市"), 7, 7,
     L("SNS 게시물 · 광고가 이 날에 맞춰 나가요.", "The social posts · ads go out on this day.",
       "社媒帖子 · 广告在这一天发布。")),
)  # fmt: skip
PAST_SHIFT_S = 18 * 3600
"""The seeded past runs happened this long before the copy was made (yesterday)."""
DIGEST_FROM_S = 22 * 3600
"""The visitor was 'last here' this long ago — the first digest shows the past runs."""
DEMO_EXECUTION = ExecutionPolicy(
    allow_external_api=False,
    allow_subscription_cli=False,
    allow_internal_llm=False,
    allow_local_llm=True,
)
"""C8: nothing but the in-memory scripted connection may ever be chosen."""


def template_dir(sol: Solution) -> Path:
    own = sol.root / "demo" / "template"
    return own if own.is_dir() else TEMPLATE


# ---------------------------------------------------------------------- the server


def init_solution(path: Path, config: DemoConfig | None = None) -> Solution:
    """`solosquad demo init` — a solution that is a demo server (no org yet: each visitor
    gets their own copy when issued)."""
    sol = scaffold_solution(path, __version__)
    cfg = sol.server_config(strict=False)
    sol.update_server_config(
        server_country="KR",
        access=AccessPolicy(**{**cfg.access.model_dump(), "two_factor": False}),
    )
    save_config(sol, config or DemoConfig())
    shutil.copytree(TEMPLATE, sol.root / "demo" / "template")
    (sol.root / "demo" / "README.md").write_text(
        "# Demo template\n\nEvery demo account gets a fresh copy of `template/` as its own org"
        " (`solosquad demo issue`). Edit the example files here — `locales/en/` and"
        " `locales/zh-CN/` hold the same files for an English or Chinese account;"
        " `solosquad demo reset <id>`"
        " (or the nightly reset) applies them to an account.\n",
        encoding="utf-8",
    )
    return sol


def ensure_company(accounts: AccountStore) -> None:
    if not accounts.has_company():
        accounts.set_company(COMPANY, None)


StepRecorder = Callable[[str, str, str, int, str, str], None]
"""(org, thread id, workflow, step number, step id, status) — the usage hook."""


def demo_builder(
    config: DemoConfig, on_step: StepRecorder | None = None
) -> Callable[..., Instance]:
    """`build_engine(build=…)` for a demo server: every agent speaks through the scripted
    harness, the only connection is the in-memory one, the scenario tools are known."""
    register_tools()
    set_pace(config.step_seconds)
    harness = DemoHarness(step_seconds=config.step_seconds, chat_seconds=config.chat_seconds)

    def build(solution: Path, org: str, workspace: str, **kw: Any) -> Instance:
        inst = build_instance(solution, org, workspace, **kw)
        inst.router.connections = [SCRIPTED]
        inst.connections = [SCRIPTED]
        voice = harness.speaking(lambda: read_locale(Path(solution) / "orgs" / org))
        inst.router.harness_factory = lambda _conn, _secrets: voice
        if on_step is not None and inst.workflows is not None:
            inst.workflows.on_step = lambda *a: on_step(org, *a)
        return inst

    build.harness = harness  # type: ignore[attr-defined]
    return build


# ---------------------------------------------------------------------- one visitor


def new_password() -> str:
    """16 characters, no look-alikes (PRD §3.6.3) — printed once, only its hash is kept."""
    alphabet = "".join(c for c in string.ascii_letters + string.digits if c not in "0O1lI")
    return "".join(secrets.choice(alphabet) for _ in range(16))


def create_account(
    sol: Solution,
    store: DemoStore,
    accounts: AccountStore,
    demo_id: str,
    inquiry_id: str,
    expires: float,
    label: str = "",
    locale: str = "ko",
    *,
    company_no: str,
) -> tuple[DemoAccount, str]:
    """The login and the row — its copy is seeded next (`seed_account`). `company_no` is the
    inquiry's registration number, asked for at the demo login with the id and password."""
    check_id(demo_id)
    org = org_for(demo_id)
    if store.taken(demo_id):
        raise ValueError(f"demo id {demo_id!r} is already issued")
    if not inquiry_id.strip():
        raise ValueError("an inquiry id is required — the demo is issued from an inquiry")
    number = normalize_company_no(company_no)
    if any(u.username == org for u in accounts.users()) or (sol.orgs_dir / org).exists():
        raise ValueError(f"{demo_id!r} collides with an existing account or org")
    password = new_password()
    user = accounts.create_user(
        org, password, Role.STAFF, display=label or demo_id, locale=locale,
        assignments=[Assignment(org, None, Role.OWNER)],
    )  # fmt: skip
    acct = store.add(demo_id, user.id, inquiry_id, expires, label, locale, company_no=number)
    accounts.audit(None, "demo.issue", f"{demo_id} inquiry={inquiry_id}")
    return acct, password


async def seed_account(
    sol: Solution,
    home: Path,
    acct: DemoAccount,
    accounts: AccountStore,
    *,
    build: Callable[..., Instance] | None = None,
    now: float | None = None,
) -> None:
    """The visitor's copy from the template, people, calendar and yesterday's runs — in the
    visitor's screen language (their `users.locale` now, else the language it was issued in)."""
    t = time.time() if now is None else now
    lang = account_locale(accounts, acct)
    org = scaffold_org(sol, acct.org, "bundled", __version__, pick(ORG_DISPLAY, lang))
    ws = scaffold_workspace(org, ORG_WORKSPACE, pick(WS_DISPLAY, lang))
    ws.save_config(ws.config().model_copy(update={"execution": DEMO_EXECUTION}))
    files = org.root / "files"
    for rel, src in template_files(sol, lang).items():
        dest = org.root / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        text = src.read_text(encoding="utf-8")
        dest.write_text(text.replace("__FILES__", files.as_posix()), encoding="utf-8")
    write_locale(org.root, lang)
    ensure_company(accounts)
    members = _people(sol, home, acct, accounts, lang)
    _calendar(accounts, acct, t, lang)
    await _past_runs(sol, home, acct, members, build=build, now=t, lang=lang)
    accounts.touch(acct.user_id, t - DIGEST_FROM_S, new_visit=True)


def account_locale(accounts: AccountStore, acct: DemoAccount) -> Lang:
    try:
        chosen = accounts.user(acct.user_id).locale
    except Exception:  # the login was removed — the language it was issued in
        chosen = None
    return known(chosen or acct.locale)


def template_files(sol: Solution, lang: str) -> dict[Path, Path]:
    """{path in the copy: source} — the template's files, with `locales/<lang>/` in place of
    the Korean ones (the solution's own template first, then the bundled one's language)."""
    root = template_dir(sol)
    out = {
        src.relative_to(root): src
        for src in sorted(root.rglob("*"))
        if src.is_file() and src.relative_to(root).parts[0] != "locales"
    }
    if known(lang) != "ko":
        for base in (root, TEMPLATE):
            layer = base / "locales" / known(lang)
            if layer.is_dir():
                for src in sorted(layer.rglob("*")):
                    if src.is_file():
                        out[src.relative_to(layer)] = src
                break
    return out


def _people(
    sol: Solution, home: Path, acct: DemoAccount, accounts: AccountStore, lang: Lang = "ko"
) -> dict[str, str]:
    """The example people of the copy → {suffix: user id}. Random passwords nobody knows,
    and a demo server signs in demo accounts only — they can never log in."""
    org_store = open_org(sol, acct.org, home)
    org_store.set_member(acct.user_id, title=pick(OWNER_TITLE, lang), teams=[])
    out = {}
    for suffix, display, title, teams in MEMBERS:
        name = f"{acct.org}.{suffix}"
        found = [u for u in accounts.users() if u.username == name]
        user = found[0] if found else accounts.create_user(
            name, secrets.token_urlsafe(24), Role.STAFF, display=pick(display, lang),
            assignments=[Assignment(acct.org, None, Role.STAFF)],
        )  # fmt: skip
        org_store.set_member(user.id, title=pick(title, lang), teams=teams)
        out[suffix] = user.id
    return out


def _calendar(accounts: AccountStore, acct: DemoAccount, now: float, lang: Lang = "ko") -> None:
    today = dt.date.fromtimestamp(now)
    cal = CalendarStore(accounts.path)
    seed_demo(cal, acct.org, acct.user_id, today=today.isoformat())
    who = Viewer(acct.user_id, lambda _o, _w: True)

    def day(n: int) -> str:
        return (today + dt.timedelta(days=n)).isoformat()

    for title, start, end, notes in CALENDAR:
        cal.create_item(
            who,
            {"kind": "work", "org": acct.org, "title": pick(title, lang), "start": day(start),
             "end": day(end), "status": "planned", "notes": pick(notes, lang)},
        )  # fmt: skip


async def _past_runs(
    sol: Solution,
    home: Path,
    acct: DemoAccount,
    members: dict[str, str],
    *,
    build: Callable[..., Instance] | None,
    now: float,
    lang: Lang = "ko",
) -> None:
    """Play each scenario once, fast, answering every card — then move it all to yesterday,
    so the dashboard, 과제 and the workflow screens have history before anything runs live.
    The usage hook is not attached here: the seed is not the visitor."""
    make = demo_builder(load_config(sol)) if build is None else build
    harness: DemoHarness | None = getattr(make, "harness", None)
    saved = (Pace.tool_seconds, harness.step_seconds if harness else 0.0)
    chat = harness.chat_seconds if harness else 0.0
    Pace.tool_seconds = 0
    if harness:
        harness.step_seconds = harness.chat_seconds = 0
    data = EngineStore(home).data_dir(sol.org(acct.org).workspace(ORG_WORKSPACE))
    inst = make(sol.root, acct.org, ORG_WORKSPACE, data_dir=data)
    started = time.time()
    decided: list[tuple[str, dict[str, Any], str]] = []
    answers: dict[str, dict[str, str]] = {"sns-marketing": {"ad_spend": "declined"}}
    try:
        if inst.workflows is not None:
            inst.workflows.on_step = None
        await start_instance(inst)
        assert inst.workflows is not None
        for name in SCENARIOS:
            tid, cards = await run_through(inst.workflows, name, answers.get(name))
            for card in cards:
                value = answers.get(name, {}).get(str(card.get("step")), "approved")
                decided.append((tid, card, value))
        tid = inst.manager.create_thread(pick(QUESTION[0], lang))
        rid = await inst.manager.submit(tid, pick(QUESTION[1], lang))
        await inst.manager.wait(rid, 30)
    finally:
        await stop_instance(inst)
        Pace.tool_seconds = saved[0]
        if harness:
            harness.step_seconds, harness.chat_seconds = saved[1], chat
    org_store = open_org(sol, acct.org, home)
    approver = {"review": members["finance"], "publish": members["marketing"]}
    for tid, card, value in decided:
        cat = str(card.get("category"))
        org_store.audit(
            approver.get(cat, acct.user_id),
            "approval",
            json.dumps(
                {"source": "workflow", "thread": tid, "value": value, "category": cat,
                 "team": card.get("team"), "approver": "seed"},
                ensure_ascii=False,
            ),
            workspace=ORG_WORKSPACE,
        )  # fmt: skip
    shift = (now - PAST_SHIFT_S) - started
    _shift(data / OFFICE_DB, started, shift)
    _shift(EngineStore(home).org_data_dir(sol.org(acct.org)) / ORG_DB, started, shift)


TIMES = {
    "threads": ("created", "updated"),
    "runs": ("created", "started", "ended"),
    "wf_threads": ("created", "updated"),
    "wf_runs": ("created", "started", "ended"),
    "artifacts": ("created",),
    "ledger": ("ts",),
    "org_audit": ("ts",),
}


def _shift(path: Path, since: float, delta: float) -> None:
    """Move every time written since `since` by `delta` seconds (the seeded history)."""
    if not path.is_file():
        return
    db = connect(path)
    try:
        have = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        for table, cols in TIMES.items():
            if table not in have:
                continue
            for col in cols:
                db.execute(
                    f"UPDATE {table} SET {col} = {col} + ? WHERE {col} >= ?", (delta, since - 1)
                )
    finally:
        db.close()


# ---------------------------------------------------------------------- reset · revoke


def wipe_org(sol: Solution, home: Path, acct: DemoAccount, accounts: AccountStore) -> None:
    """Remove the visitor's copy: org files, data, calendar, example people. The demo login,
    its row and its usage stay. The runtime must already be stopped."""
    _remove_tree(sol.orgs_dir / acct.org)
    _remove_tree(EngineStore(home).solution_data_dir(sol) / acct.org)
    with accounts.lock:
        _delete(accounts.connection(), acct)


def _remove_tree(path: Path, tries: int = 20) -> None:
    """`rmtree` that waits for handles a just-stopped runtime still holds (Windows refuses to
    delete an open file; SQLite closes its files only when the connection is collected). Raises
    if the copy is still there after the retries, so a reset never silently keeps old data."""
    close_under(path)
    for i in range(tries):
        if not path.exists():
            return
        try:
            shutil.rmtree(path)
            return
        except OSError:
            if i == tries - 1:
                raise
            gc.collect()
            time.sleep(0.1 * (i + 1))


def _delete(db: sqlite3.Connection, acct: DemoAccount) -> None:
    members = [
        r[0] for r in db.execute("SELECT id FROM users WHERE username LIKE ?", (f"{acct.org}.%",))
    ]
    people = [*members, acct.user_id]
    marks = ",".join("?" * len(people))
    scope = (acct.org, *people)
    mine = f"org = ? OR (kind = 'personal' AND owner_id IN ({marks}))"
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "cal_items" in tables:
        items = f"SELECT id FROM cal_items WHERE {mine}"
        db.execute(f"DELETE FROM cal_item_tags WHERE item_id IN ({items})", scope)
        db.execute(f"DELETE FROM cal_todos WHERE item_id IN ({items})", scope)
        db.execute(f"DELETE FROM cal_items WHERE {mine}", scope)
        db.execute(f"DELETE FROM cal_labels WHERE scope = ? OR scope IN ({marks})", scope)
        db.execute(f"DELETE FROM cal_seeded WHERE scope = ? OR scope IN ({marks})", scope)
    for uid in members:
        for table in ("assignments", "sessions", "passkeys", "presence", "last_scope"):
            if table in tables:
                db.execute(f"DELETE FROM {table} WHERE user_id = ?", (uid,))
        db.execute("DELETE FROM users WHERE id = ?", (uid,))
    for table in ("presence", "last_scope"):
        if table in tables:
            db.execute(f"DELETE FROM {table} WHERE user_id = ?", (acct.user_id,))


async def reset_account(
    sol: Solution,
    home: Path,
    store: DemoStore,
    accounts: AccountStore,
    acct: DemoAccount,
    *,
    build: Callable[..., Instance] | None = None,
) -> None:
    """A fresh copy for one visitor (the runtime, if any, already stopped)."""
    wipe_org(sol, home, acct, accounts)
    await seed_account(sol, home, acct, accounts, build=build)
    store.mark_seeded(acct.demo_id, acct.generation)


def open_stores(sol: Solution, home: Path | None = None) -> tuple[AccountStore, DemoStore]:
    accounts = open_accounts(sol, home or solosquad_home())
    return accounts, DemoStore(accounts.path)


__all__ = [
    "COMPANY",
    "SCRIPTED",
    "account_locale",
    "create_account",
    "demo_builder",
    "ensure_company",
    "init_solution",
    "open_stores",
    "reset_account",
    "seed_account",
    "template_files",
    "wipe_org",
]
