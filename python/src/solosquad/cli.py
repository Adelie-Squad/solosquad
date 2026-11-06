"""`solosquad` command line (v2). Sync face only — the engine itself is async (decision 23)."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import signal
import subprocess
from collections.abc import Coroutine
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any

import typer
from rich.console import Console
from rich.markup import escape
from rich.table import Table
from rich.tree import Tree

from solosquad import __version__
from solosquad.assets.bundle import find_bundle_root, load_bundle
from solosquad.client import Client, HttpClient, LocalClient, message_text, server_file
from solosquad.layout import (
    EngineStore,
    LayoutError,
    Solution,
    WorkspaceType,
    scaffold_org,
    scaffold_solution,
    scaffold_workspace,
    solosquad_home,
)
from solosquad.profile import (
    CustomerProfile,
    load_profile,
    parse_entity,
    save_profile,
)
from solosquad.routing import (
    Connection,
    ConnectionKind,
    SecretStore,
    load_connections,
    save_connections,
)
from solosquad.service import ServiceSpec, plan
from solosquad.storage import ORG_DB

if TYPE_CHECKING:
    from solosquad.engine_server import EngineServer
    from solosquad.web_api.accounts import AccountStore

app = typer.Typer(no_args_is_help=True, add_completion=False)
add_app = typer.Typer(no_args_is_help=True, help="Add an org (business) or a workspace (office).")
conn_app = typer.Typer(
    no_args_is_help=True, help="LLM connections: subscription logins and API keys."
)
agents_app = typer.Typer(no_args_is_help=True, help="Watch the agents work.")
service_app = typer.Typer(no_args_is_help=True, help="Run the engine server 24/7 as an OS service.")
cron_app = typer.Typer(no_args_is_help=True, help="An org's scheduled runs.")
accounts_app = typer.Typer(
    no_args_is_help=True, help="People who log in to the web — one account each for the customer."
)
app.add_typer(add_app, name="add")
app.add_typer(cron_app, name="cron")
app.add_typer(accounts_app, name="accounts")
profile_app = typer.Typer(no_args_is_help=True, help="The customer profile filled in at setup.")
app.add_typer(profile_app, name="profile")
workflows_app = typer.Typer(no_args_is_help=True, help="An org's workflows (steps · approvals).")
app.add_typer(workflows_app, name="workflows")
web_app = typer.Typer(no_args_is_help=True, help="The customer web: its API contract.")
app.add_typer(web_app, name="web")
app.add_typer(conn_app, name="connections")
app.add_typer(agents_app, name="agents")
app.add_typer(service_app, name="service")
console = Console()

BUNDLED_PACKAGE = "bundled"

SolutionOpt = Annotated[Path, typer.Option("--solution", "-s", help="Customer-solution directory.")]
OrgOpt = Annotated[
    str | None, typer.Option("--org", help="Org (business); defaults to the only one.")
]
WsOpt = Annotated[
    str | None,
    typer.Option("--workspace", "-w", help="Workspace (office); defaults to the only one."),
]


def _run[R](coro: Coroutine[Any, Any, R]) -> R:
    return asyncio.run(coro)


def _fail(msg: str) -> typer.Exit:
    console.print(f"[red]{msg}[/red]")
    return typer.Exit(1)


def _pick(solution: Path, org: str | None, workspace: str | None) -> tuple[str, str]:
    sol = Solution(solution)
    try:
        orgs = [o.name for o in sol.orgs()]
        o = org or (orgs[0] if len(orgs) == 1 else None)
        if o is None:
            raise _fail(f"pass --org (found {orgs})")
        wss = [w.name for w in sol.org(o).workspaces()]
        w = workspace or (wss[0] if len(wss) == 1 else None)
        if w is None:
            raise _fail(f"pass --workspace (found {wss})")
        sol.org(o).workspace(w)
    except LayoutError as e:
        raise _fail(str(e)) from e
    return o, w


def _pick_org(solution: Path, org: str | None) -> str:
    orgs = [x.name for x in Solution(solution).orgs()]
    o = org or (orgs[0] if len(orgs) == 1 else None)
    if o is None or o not in orgs:
        raise _fail(f"pass --org (found {orgs})")
    return o


def _data_dir(solution: Path, org: str, workspace: str) -> Path:
    return EngineStore(solosquad_home()).data_dir(Solution(solution).org(org).workspace(workspace))


def _accounts(solution: Path) -> AccountStore:
    """The customer's `core.db` — a rev6 org's accounts are moved in first (C32)."""
    from solosquad.storage import MigrationFailed
    from solosquad.web_api.org_store import open_accounts

    try:
        return open_accounts(Solution(solution))
    except MigrationFailed as e:
        raise _fail(str(e)) from e


def _web_dist() -> Path | None:
    """The built customer web next to the engine (`web/dist`), when present."""
    bundle = find_bundle_root(Path(__file__).resolve().parent)
    dist = bundle / "web" / "dist" if bundle else None
    return dist if dist is not None and dist.is_dir() else None


def _customer_dir(solution: Path) -> Path:
    """`data/<solution-id>/` — `core.db`, the engine server's token and `server.json`."""
    return EngineStore(solosquad_home()).solution_data_dir(Solution(solution))


def _client(solution: Path, org: str | None, workspace: str | None) -> Client:
    o, w = _pick(solution, org, workspace)
    sf = server_file(_customer_dir(solution))
    if sf.is_file():
        info = json.loads(sf.read_text(encoding="utf-8"))
        client = HttpClient(f"http://127.0.0.1:{info['port']}", info["token"])
        try:
            client._call("GET", "/version")
            return client
        except OSError:
            pass
    from solosquad.instance import build_instance

    return LocalClient(build_instance(solution, o, w))


# ---------------------------------------------------------------------- basics


@app.command()
def version() -> None:
    """Print the engine version."""
    console.print(__version__)


@app.command()
def assets(
    root: Annotated[
        Path | None,
        typer.Option(
            help="Bundle root (defaults to the nearest ancestor with agents/ and teams/)."
        ),
    ] = None,
) -> None:
    """Parse the bundled agents, skills, teams and crons and report what was found."""
    bundle_root = root or find_bundle_root(Path.cwd())
    if bundle_root is None:
        raise _fail("no bundle found — pass --root")
    bundle = load_bundle(bundle_root)
    table = Table("kind", "count")
    for kind, items in (
        ("agents", bundle.agents),
        ("skills", bundle.skills),
        ("teams", bundle.teams),
        ("crons", bundle.crons),
    ):
        table.add_row(kind, str(len(items)))
    console.print(table)
    for err in bundle.errors:
        console.print(f"[red]{err}[/red]")
    if bundle.errors:
        raise typer.Exit(1)


@app.command()
def init(
    path: Annotated[Path, typer.Argument(help="Directory for the new customer solution.")],
    org: Annotated[str, typer.Option(help="First org (business) name.")],
    workspace: Annotated[str, typer.Option(help="First workspace (office) name.")] = "hq",
    ws_type: Annotated[WorkspaceType, typer.Option("--type")] = WorkspaceType.LOCAL,
    server_country: Annotated[
        str | None, typer.Option("--server-country", help="ISO country of the server, e.g. KR")
    ] = None,
    cloud: Annotated[str | None, typer.Option(help="Cloud provider, e.g. aws · gcp · ncp")] = None,
    region: Annotated[str | None, typer.Option(help="Cloud region, e.g. ap-northeast-2")] = None,
    cloud_access: Annotated[
        str | None, typer.Option("--cloud-access", help="How the agency reaches it (no secrets)")
    ] = None,
    entity: Annotated[
        list[str] | None,
        typer.Option("--entity", help="Account-holding entity: id=name:country[:controlled_by]"),
    ] = None,
    language: Annotated[
        str | None, typer.Option(help="Default UI language: ko · en · zh-CN")
    ] = None,
    privacy_regime: Annotated[
        list[str] | None, typer.Option("--privacy-regime", help="e.g. PIPA, PIPL")
    ] = None,
    privacy_reviewer: Annotated[
        str | None, typer.Option("--privacy-reviewer", help="A role, e.g. 고객 법무팀")
    ] = None,
) -> None:
    """Create core/, the first org and its first workspace — and the customer profile."""
    bundle = find_bundle_root(Path(__file__).resolve().parent) or find_bundle_root(Path.cwd())
    try:
        profile = _apply_profile(
            CustomerProfile(), server_country, cloud, region, cloud_access, entity, language,
            privacy_regime, privacy_reviewer,
        )  # fmt: skip
        sol = scaffold_solution(path, __version__, bundle / "user" if bundle else None, ws_type)
        new_org = scaffold_org(sol, org, BUNDLED_PACKAGE, __version__)
        scaffold_workspace(new_org, workspace)
        save_profile(path, profile)  # the server country lands in core/server.yaml (I41)
    except (LayoutError, ValueError) as e:
        raise _fail(str(e)) from e
    console.print(f"created {path} — org {org!r}, workspace {workspace!r} ({ws_type.value})")
    _print_checklist(profile)
    console.print("next: solosquad connections add … , then solosquad chat -s " + str(path))


@app.command()
def layout(
    path: Annotated[Path, typer.Argument(help="Customer solution directory.")] = Path("."),
) -> None:
    """Show a customer solution's orgs and workspaces."""
    sol = Solution(path)
    try:
        lock, meta = sol.engine_lock(), sol.meta()
    except LayoutError as e:
        raise _fail(str(e)) from e
    try:
        server = sol.server_config(strict=False)
    except ValueError as e:
        raise _fail(str(e)) from e
    tree = Tree(f"{path} · {meta.id} · engine {lock.version} · server {server.type.value}")
    for o in sol.orgs():
        node = tree.add(f"org {o.name} · {o.lock().package}@{o.lock().version}")
        for ws in o.workspaces():
            placed = "" if server.placement.places(o.name, ws.name) else " · not placed here"
            node.add(f"workspace {ws.name}{placed}")
    console.print(tree)


@add_app.command("org")
def add_org(name: str, solution: SolutionOpt = Path("."), workspace: str = "hq") -> None:
    """Create an org from the bundled org package (core is not touched)."""
    try:
        org = scaffold_org(Solution(solution), name, BUNDLED_PACKAGE, __version__)
        scaffold_workspace(org, workspace)
    except LayoutError as e:
        raise _fail(str(e)) from e
    console.print(f"org {name!r} with workspace {workspace!r}")


@add_app.command("workspace")
def add_workspace(
    name: str,
    org: Annotated[str, typer.Option("--org")],
    solution: SolutionOpt = Path("."),
) -> None:
    """Add a workspace (business unit) to an org — it runs on this customer's server, whose
    address, country and type are in core/server.yaml (I41)."""
    try:
        scaffold_workspace(Solution(solution).org(org), name)
    except LayoutError as e:
        raise _fail(str(e)) from e
    console.print(f"workspace {name!r} in org {org!r}")


# ---------------------------------------------------------------------- connections


def _conn_path(solution: Path, org: str | None) -> Path:
    sol = Solution(solution)
    return sol.org(org).root / "connections.yaml" if org else sol.connections_path


@conn_app.command("list")
def conn_list(
    solution: SolutionOpt = Path("."),
    org: Annotated[
        str | None, typer.Option("--org", help="List the org's own connections.")
    ] = None,
) -> None:
    table = Table("id", "kind", "harness", "models", "active", "slots", "budget/mo", "network")
    for c in load_connections(_conn_path(solution, org)):
        table.add_row(
            c.id,
            c.kind.value,
            c.harness,
            ",".join(c.models),
            "yes" if c.active else "no",
            str(c.slots),
            str(c.monthly_budget_usd or "-"),
            c.network,
        )
    console.print(table)


@conn_app.command("add")
def conn_add(
    id: Annotated[str, typer.Argument(help="A name you will recognise, e.g. claude-max-2")],
    kind: Annotated[ConnectionKind, typer.Option("--kind")],
    harness: Annotated[
        str, typer.Option("--harness", help="claude-code · codex · opencode · lite")
    ],
    provider: Annotated[str, typer.Option("--provider")] = "anthropic",
    models: Annotated[str, typer.Option("--models", help="comma-separated, e.g. sonnet,opus")] = "",
    base_url: Annotated[str | None, typer.Option("--base-url")] = None,
    secret_env: Annotated[
        str | None, typer.Option("--secret-env", help="env var the harness reads the key from")
    ] = None,
    slots: int = 2,
    budget: Annotated[float | None, typer.Option("--budget", help="monthly USD cap")] = None,
    network: str = "external",
    solution: SolutionOpt = Path("."),
    org: Annotated[
        str | None, typer.Option("--org", help="Add to one org only (separate billing).")
    ] = None,
    entity: Annotated[
        str | None,
        typer.Option("--entity", help="Profile entity id that holds this account (decision 45)"),
    ] = None,
) -> None:
    """Add a subscription login or an API key (decision 22). Keys go in with `set-secret`."""
    from solosquad.routing.eligibility import Entity, judge, providers_reached

    holder: Entity | None = None
    if entity is not None:
        try:
            pe = load_profile(solution).entity(entity)
        except KeyError as e:
            raise _fail(str(e).strip("'\"")) from e
        holder = Entity(name=pe.name, country=pe.country, controlled_by=pe.controlled_by)
    model_list = [m for m in models.split(",") if m]
    if holder is None and providers_reached(provider, harness, model_list):
        raise _fail(
            "enter the entity that holds this account: --entity <id> (see `solosquad profile`)"
        )
    verdict = judge(provider, harness, model_list, holder, load_profile(solution).server.country)
    if not verdict.ok:
        raise _fail(f"{verdict.reason} — see {verdict.source}")
    path = _conn_path(solution, org)
    conns = [c for c in load_connections(path) if c.id != id]
    conns.append(
        Connection(
            id=id,
            kind=kind,
            provider=provider,
            harness=harness,
            models=[m for m in models.split(",") if m],
            base_url=base_url,
            secret_ref=id if secret_env else None,
            secret_env=secret_env,
            slots=slots,
            monthly_budget_usd=budget,
            network=network,
            entity=holder,
        )
    )
    save_connections(path, conns)
    console.print(f"connection {id!r} added ({kind.value} via {harness})")
    if kind is ConnectionKind.SUBSCRIPTION and harness == "claude-code":
        console.print(
            "log the account in once on this machine: run `claude` and sign in,"
            " then `solosquad connections check`"
        )


def _toggle(id: str, solution: Path, org: str | None, active: bool) -> None:
    path = _conn_path(solution, org)
    conns = load_connections(path)
    if not any(c.id == id for c in conns):
        raise _fail(f"no connection {id!r}")
    save_connections(
        path, [c.model_copy(update={"active": active}) if c.id == id else c for c in conns]
    )
    console.print(f"{id}: {'active' if active else 'inactive'}")


@conn_app.command("enable")
def conn_enable(
    id: str,
    solution: SolutionOpt = Path("."),
    org: Annotated[str | None, typer.Option("--org")] = None,
) -> None:
    _toggle(id, solution, org, True)


@conn_app.command("disable")
def conn_disable(
    id: str,
    solution: SolutionOpt = Path("."),
    org: Annotated[str | None, typer.Option("--org")] = None,
) -> None:
    _toggle(id, solution, org, False)


@conn_app.command("remove")
def conn_remove(
    id: str,
    solution: SolutionOpt = Path("."),
    org: Annotated[str | None, typer.Option("--org")] = None,
) -> None:
    path = _conn_path(solution, org)
    save_connections(path, [c for c in load_connections(path) if c.id != id])
    console.print(f"{id}: removed")


@conn_app.command("set-secret")
def conn_set_secret(
    id: str, solution: SolutionOpt = Path("."), org: OrgOpt = None, workspace: WsOpt = None
) -> None:
    """Store an API key in each workspace's data folder (outside git, mode 0600) — every
    workspace by default, or those of `--org` / just `--workspace`."""
    sol = Solution(solution)
    try:
        places = [
            ws
            for ws in sol.workspaces()
            if (org is None or ws.org.name == org) and (workspace is None or ws.name == workspace)
        ]
    except LayoutError as e:
        raise _fail(str(e)) from e
    if not places:
        raise _fail("no workspace matches --org / --workspace")
    value = typer.prompt(f"key for {id}", hide_input=True)
    for ws in places:
        SecretStore(_data_dir(solution, ws.org.name, ws.name) / "secrets.json").set(id, value)
    console.print(f"{id}: key stored for {', '.join(f'{w.org.name}/{w.name}' for w in places)}")


@conn_app.command("check")
def conn_check(
    solution: SolutionOpt = Path("."), org: OrgOpt = None, workspace: WsOpt = None
) -> None:
    """Ask each connection's harness whether it is usable right now."""
    from solosquad.routing.router import default_harness

    o, w = _pick(solution, org, workspace)
    secrets = SecretStore(_data_dir(solution, o, w) / "secrets.json")
    table = Table("id", "harness", "usable", "detail")
    for c in load_connections(Solution(solution).connections_path) + load_connections(
        Solution(solution).org(o).root / "connections.yaml"
    ):
        status = _run(default_harness(c, secrets).auth_status())
        table.add_row(
            c.id, c.harness, "yes" if status.logged_in else "no", json.dumps(status.detail)[:60]
        )
    console.print(table)


# ---------------------------------------------------------------------- run


def _engine(solution: Path, include: list[str] | None = None) -> EngineServer:
    """Every placed workspace's runtime — refuses on a server-settings conflict (C33) or a
    failed account move (C32), never on one broken workspace (K49)."""
    from solosquad.engine_server import build_engine
    from solosquad.storage import MigrationFailed

    try:
        return build_engine(solution, include=include)
    except (LayoutError, MigrationFailed) as e:
        raise _fail(str(e)) from e


def _placement(org: str | None, workspace: str | None) -> list[str] | None:
    """`--org` / `--workspace` narrow what this `serve` runs (default: everything placed)."""
    if workspace and not org:
        raise _fail("--workspace needs --org")
    if org:
        return [f"{org}/{workspace}" if workspace else org]
    return None


@app.command()
def serve(
    solution: SolutionOpt = Path("."),
    org: Annotated[
        str | None, typer.Option("--org", help="Run only this org (default: every placed one).")
    ] = None,
    workspace: Annotated[
        str | None,
        typer.Option("--workspace", "-w", help="Run only this workspace of --org."),
    ] = None,
    port: int = 7420,
    host: str = "127.0.0.1",
) -> None:
    """Run the customer's engine server 24/7: every placed workspace's runtime (run manager,
    crons, workflows), the login and web, daily upkeep and snapshots (decision 57 · I38)."""
    from solosquad.engine_server import start_engine, stop_engine
    from solosquad.maintenance import maintenance_loop
    from solosquad.server import ApiServer, load_or_create_token

    include = _placement(org, workspace)

    async def main() -> None:
        engine = _engine(solution, include)
        resumed = await start_engine(engine)
        for (o, w), why in sorted(engine.failed.items()):
            console.print(f"[red]workspace {o}/{w} did not start:[/red] {escape(why)}")
        token = load_or_create_token(engine.data_dir)
        upkeep = asyncio.create_task(maintenance_loop(engine))
        api = ApiServer.for_engine(engine, token, static_dir=_web_dist())
        bound = await api.start(host, port)
        sf = server_file(engine.data_dir)
        sf.write_text(
            json.dumps({"port": bound, "token": token, "pid": os.getpid()}), encoding="utf-8"
        )
        sf.chmod(0o600)
        names = ", ".join(f"{o}/{w}" for o, w in sorted(engine.runtimes)) or "nothing"
        total = sum(len(r) for r in resumed.values())
        console.print(f"serving {names} on http://{host}:{bound} · resumed {total} run(s)")
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(sig, stop.set)
        await stop.wait()
        upkeep.cancel()
        await api.stop()
        await stop_engine(engine)
        sf.unlink(missing_ok=True)

    _run(main())


async def _drive(client: Client, tid: str, run_id: str, seen: int) -> int:
    """Wait for a run, print new messages, ask for approval if it paused. → messages seen."""
    while True:
        run = await client.wait(run_id)
        msgs = await client.messages(tid)
        for m in msgs[seen:]:
            if m["role"] == "assistant" and message_text(m):
                console.print(f"[bold]{m.get('name') or 'agent'}[/bold] {escape(message_text(m))}")
        seen = len(msgs)
        if run["status"] == "interrupted":
            for i in run.get("interrupts") or []:
                v = i.get("value") or {}
                reason = escape(str(v.get("reason")))
                console.print(f"[yellow]approval needed[/yellow] ({v.get('agent')}): {reason}")
            ok = await asyncio.to_thread(typer.confirm, "approve?", default=False)
            run_id = await client.resume(tid, "approved" if ok else "declined")
            continue
        if run["status"] == "error":
            console.print(f"[red]run failed:[/red] {escape(str(run.get('error')))}")
        return seen


@app.command()
def chat(
    solution: SolutionOpt = Path("."),
    org: OrgOpt = None,
    workspace: WsOpt = None,
    thread: Annotated[
        str | None, typer.Option("--thread", help="Continue an existing thread.")
    ] = None,
    message: Annotated[
        str | None, typer.Option("--message", "-m", help="Send one message and exit.")
    ] = None,
) -> None:
    """Talk to the company (Chief first). Approvals are asked inline."""
    client = _client(solution, org, workspace)

    async def main() -> None:
        tid = thread or await client.create_thread(message[:40] if message else "chat")
        seen = len(await client.messages(tid)) if thread else 0
        console.print(f"[dim]thread {tid} — empty line to quit[/dim]")
        try:
            while True:
                text = (
                    message
                    if message is not None
                    else await asyncio.to_thread(console.input, "[bold green]you[/bold green] ")
                )
                if not text.strip():
                    return
                seen = await _drive(client, tid, await client.submit(tid, text), seen)
                if message is not None:
                    return
        finally:
            await client.close()

    _run(main())


@app.command()
def approve(
    thread: str,
    deny: bool = False,
    solution: SolutionOpt = Path("."),
    org: OrgOpt = None,
    workspace: WsOpt = None,
) -> None:
    """Answer a paused thread's approval request."""
    client = _client(solution, org, workspace)

    async def main() -> None:
        try:
            seen = len(await client.messages(thread))
            await _drive(
                client,
                thread,
                await client.resume(thread, "declined" if deny else "approved"),
                seen,
            )
        finally:
            await client.close()

    _run(main())


@app.command()
def runs(
    solution: SolutionOpt = Path("."),
    org: OrgOpt = None,
    workspace: WsOpt = None,
    status: Annotated[str | None, typer.Option("--status")] = None,
) -> None:
    """Recent runs across threads."""
    client = _client(solution, org, workspace)

    async def main() -> list[dict[str, Any]]:
        try:
            return await client.runs(status=status)
        finally:
            await client.close()

    table = Table("run", "thread", "status", "source", "error")
    for r in _run(main()):
        table.add_row(
            r["id"], r["thread_id"], r["status"], r.get("source") or "", (r.get("error") or "")[:60]
        )
    console.print(table)


@app.command()
def status(solution: SolutionOpt = Path("."), org: OrgOpt = None, workspace: WsOpt = None) -> None:
    """Threads, waiting approvals and spend by connection."""
    client = _client(solution, org, workspace)

    async def main() -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any]]:
        try:
            return (
                await client.threads(),
                await client.runs(status="interrupted"),
                await client.ledger("connection_id"),
            )
        finally:
            await client.close()

    threads, waiting, spend = _run(main())
    console.print(f"threads: {len(threads)} · waiting for approval: {len(waiting)}")
    table = Table("connection", "calls", "tokens", "cost USD")
    for k, v in spend.items():
        table.add_row(k, str(v["calls"]), f"{v['tokens']:.0f}", f"{v['cost_usd']:.4f}")
    console.print(table)


# ---------------------------------------------------------------------- checks


def _bundle_or_fail() -> Path:
    bundle = find_bundle_root(Path(__file__).resolve().parent) or find_bundle_root(Path.cwd())
    if bundle is None:
        raise _fail("bundled agents/ and teams/ not found next to the engine")
    return bundle


@app.command()
def validate(
    solution: SolutionOpt = Path("."),
    strict: Annotated[bool, typer.Option(help="Treat warnings as failures.")] = False,
) -> None:
    """Check every agent, skill, team, cron, policy and connection a workspace sees."""
    from solosquad.check import validate_solution

    reports = validate_solution(solution, _bundle_or_fail())
    errors = warns = 0
    for key, report in sorted(reports.items()):
        label = key or "layout"
        if not report.issues:
            console.print(f"[green]✓[/green] {label}")
            continue
        console.print(f"[bold]{label}[/bold]")
        for i in report.issues:
            tag = "[red]error[/red]" if i.severity == "error" else "[yellow]warn [/yellow]"
            where = f" {escape(i.path)}" if i.path else ""
            console.print(f"  {tag} {i.code}{where}: {escape(i.message)}")
        errors += len(report.errors)
        warns += len(report.warnings)
    console.print(f"{errors} error(s) · {warns} warning(s)")
    if errors or (strict and warns):
        raise typer.Exit(1)


@app.command()
def doctor(solution: SolutionOpt = Path(".")) -> None:
    """Environment check without calling an LLM: python, bundle, layout, CLIs, data folders."""
    from solosquad.check import doctor_checks

    bundle = find_bundle_root(Path(__file__).resolve().parent) or find_bundle_root(Path.cwd())
    checks = doctor_checks(solution, bundle)
    table = Table("check", "status", "detail")
    colour = {"ok": "green", "warn": "yellow", "fail": "red"}
    for c in checks:
        table.add_row(c.name, f"[{colour[c.status]}]{c.status}[/]", escape(c.detail))
    console.print(table)
    console.print("logins: solosquad connections check (asks each harness)")
    if any(c.status == "fail" for c in checks):
        raise typer.Exit(1)


@cron_app.command("list")
def cron_list(solution: SolutionOpt = Path("."), org: OrgOpt = None) -> None:
    """Crons of an org — schedule, standing thread, enabled."""
    from solosquad.runtime.manager import load_crons

    o = _pick_org(solution, org)
    table = Table("cron", "schedule", "thread", "enabled")
    for c in load_crons(Solution(solution).org(o).root / "crons"):
        table.add_row(
            c.name, c.schedule, c.thread or "(new each run)", "yes" if c.enabled else "no"
        )
    console.print(table)


@cron_app.command("run")
def cron_run(
    name: Annotated[str, typer.Argument(help="Cron name (file stem under orgs/<org>/crons/).")],
    solution: SolutionOpt = Path("."),
    org: OrgOpt = None,
    workspace: WsOpt = None,
) -> None:
    """Fire a cron now, on a fresh thread, and print what the agents said."""
    from solosquad.runtime.manager import load_crons

    o, w = _pick(solution, org, workspace)
    crons = {c.name: c for c in load_crons(Solution(solution).org(o).root / "crons")}
    if name not in crons:
        raise _fail(f"no cron {name!r} (found {sorted(crons)})")
    cron = crons[name]
    client = _client(solution, o, w)

    async def main() -> None:
        try:
            tid = await client.create_thread(
                f"cron {name} (manual)", {"cron": name, "manual": True}
            )
            await _drive(client, tid, await client.submit(tid, cron.prompt), 0)
        finally:
            await client.close()

    _run(main())


# ---------------------------------------------------------------------- customer profile


def _apply_profile(
    base: CustomerProfile,
    server_country: str | None,
    cloud: str | None,
    region: str | None,
    cloud_access: str | None,
    entity: list[str] | None,
    language: str | None,
    privacy_regime: list[str] | None,
    privacy_reviewer: str | None,
) -> CustomerProfile:
    data = base.model_dump()
    srv = data["server"]
    for key, val in (("country", server_country), ("cloud", cloud), ("region", region),
                     ("access", cloud_access)):  # fmt: skip
        if val is not None:
            srv[key] = val
    if entity:
        by_id = {e["id"]: e for e in data["entities"]}
        for spec in entity:
            parsed = parse_entity(spec)
            by_id[parsed.id] = parsed.model_dump()
        data["entities"] = list(by_id.values())
    if language is not None:
        data["languages"]["default"] = language
    if privacy_regime:
        data["privacy"]["regimes"] = sorted({*data["privacy"]["regimes"], *privacy_regime})
    if privacy_reviewer is not None:
        data["privacy"]["reviewer"] = privacy_reviewer
    return CustomerProfile.model_validate(data)


def _print_checklist(profile: CustomerProfile) -> None:
    table = Table("고객 프로필 (결정 50)", "")
    for item in profile.checklist():
        table.add_row(
            item["label"], "[green]✓[/green]" if item["done"] else "[yellow]비어 있음[/yellow]"
        )
    console.print(table)


@profile_app.command("show")
def profile_show(solution: SolutionOpt = Path(".")) -> None:
    """The customer profile and what is still missing for setup."""
    profile = load_profile(solution)
    console.print(escape(json.dumps(profile.model_dump(mode="json", exclude_none=True),
                                    ensure_ascii=False, indent=1)))  # fmt: skip
    _print_checklist(profile)


@profile_app.command("set")
def profile_set(
    solution: SolutionOpt = Path("."),
    server_country: Annotated[
        str | None, typer.Option("--server-country", help="ISO country of the server, e.g. KR")
    ] = None,
    cloud: Annotated[str | None, typer.Option(help="Cloud provider, e.g. aws · gcp · ncp")] = None,
    region: Annotated[str | None, typer.Option(help="Cloud region, e.g. ap-northeast-2")] = None,
    cloud_access: Annotated[
        str | None, typer.Option("--cloud-access", help="How the agency reaches it (no secrets)")
    ] = None,
    entity: Annotated[
        list[str] | None,
        typer.Option("--entity", help="Account-holding entity: id=name:country[:controlled_by]"),
    ] = None,
    language: Annotated[
        str | None, typer.Option(help="Default UI language: ko · en · zh-CN")
    ] = None,
    privacy_regime: Annotated[
        list[str] | None, typer.Option("--privacy-regime", help="e.g. PIPA, PIPL")
    ] = None,
    privacy_reviewer: Annotated[
        str | None, typer.Option("--privacy-reviewer", help="A role, e.g. 고객 법무팀")
    ] = None,
) -> None:
    """Fill in or change profile items; the server country is kept in core/server.yaml."""
    try:
        profile = _apply_profile(
            load_profile(solution), server_country, cloud, region, cloud_access, entity, language,
            privacy_regime, privacy_reviewer,
        )  # fmt: skip
        save_profile(solution, profile)
    except (ValueError, LayoutError) as e:
        raise _fail(str(e)) from e
    _print_checklist(profile)


# ---------------------------------------------------------------------- data upkeep


@app.command()
def maintenance(solution: SolutionOpt = Path(".")) -> None:
    """Apply the retention rules now, for every workspace (normally daily inside `serve`)."""
    from solosquad.maintenance import run_customer_retention

    counts = run_customer_retention(_engine(solution))
    table = Table("scope", "removed")
    for k, v in counts.items():
        table.add_row(k, escape(json.dumps(v, ensure_ascii=False)))
    console.print(table)


@app.command("backup")
def backup_cmd(
    solution: SolutionOpt = Path("."),
    to: Annotated[Path | None, typer.Option(help="Folder for the copies.")] = None,
) -> None:
    """Online copy of core.db, every org.db and every office.db, all of one moment, with a
    manifest (safe while the server runs)."""
    from solosquad.maintenance import backup_customer

    manifest = backup_customer(_engine(solution), to)
    for entry in manifest["files"]:
        console.print(f"{entry['name']}: {entry['bytes']} B · sha256 {entry['sha256'][:12]}…")


snapshot_app = typer.Typer(no_args_is_help=True, help="Daily snapshots to the customer's bucket.")
app.add_typer(snapshot_app, name="snapshot")


@snapshot_app.command("set")
def snapshot_set(
    target: Annotated[str, typer.Option("--type", help="s3 (any S3-compatible store) · dir")],
    solution: SolutionOpt = Path("."),
    endpoint: Annotated[
        str | None, typer.Option(help="e.g. https://s3.ap-northeast-2.amazonaws.com")
    ] = None,
    region: str = "us-east-1",
    bucket: str | None = None,
    prefix: str = "solosquad",
    path: Annotated[str | None, typer.Option(help="Folder for a dir target")] = None,
    keep_days: int = 30,
) -> None:
    """Configure the customer's target (core/server.yaml); for s3 the keys are asked for and
    kept in the customer's secret store."""
    from solosquad.snapshots import S3_SECRET_REF, build_target

    try:
        cfg = build_target(
            target, endpoint=endpoint, region=region, bucket=bucket, prefix=prefix, path=path,
            keep_days=keep_days,
        )  # fmt: skip
    except ValueError as e:
        raise _fail(str(e)) from e
    if target == "s3":
        access: str = typer.prompt("access key id")
        secret: str = typer.prompt("secret access key", hide_input=True)
        SecretStore(_customer_dir(solution) / "secrets.json").set(
            S3_SECRET_REF, f"{access}:{secret}"
        )
    try:
        Solution(solution).update_server_config(snapshot=cfg)
    except LayoutError as e:
        raise _fail(str(e)) from e
    console.print(f"snapshot target: {target} · keep {keep_days} days")


@snapshot_app.command("run")
def snapshot_run(solution: SolutionOpt = Path(".")) -> None:
    """Back up every database at one moment and ship it now (normally daily in `serve`)."""
    from solosquad.maintenance import run_snapshot

    try:
        result = run_snapshot(_engine(solution))
    except (ValueError, OSError) as e:
        raise _fail(str(e)) from e
    console.print(escape(json.dumps(result, ensure_ascii=False)))


@snapshot_app.command("restore")
def snapshot_restore(
    solution: SolutionOpt = Path("."),
    stamp: Annotated[
        str | None, typer.Option(help="UTC stamp, e.g. 20261105T020000Z; newest if omitted")
    ] = None,
    yes: Annotated[bool, typer.Option("--yes", help="Do not ask for confirmation")] = False,
) -> None:
    """Restore core.db, every org.db and every office.db from one snapshot (the engine
    server must be stopped)."""
    import tempfile

    from solosquad.snapshots import fetch, restore
    from solosquad.storage import CORE_DB, OFFICE_DB

    sol = Solution(solution)
    store = EngineStore(solosquad_home())
    data = _customer_dir(solution)
    if server_file(data).is_file():
        raise _fail("stop the server first (`solosquad service uninstall` or stop `serve`)")
    target = sol.server_config().snapshot
    secrets = SecretStore(data / "secrets.json")
    targets = {"core": data / CORE_DB}
    for o in sol.orgs():
        targets[f"org~{o.name}"] = store.org_data_dir(o) / ORG_DB
        for ws in o.workspaces():
            targets[f"office~{o.name}~{ws.name}"] = store.data_dir(ws) / OFFICE_DB
    with tempfile.TemporaryDirectory(prefix="solosquad-restore-") as tmp:
        try:
            chosen = fetch(target, sol.meta().id, stamp, Path(tmp), secret=secrets.get)
        except (KeyError, ValueError, OSError) as e:
            raise _fail(str(e).strip("'\"")) from e
        if not yes and not typer.confirm(f"restore snapshot {chosen} over the live databases?"):
            raise typer.Exit(1)
        try:
            done = restore(Path(tmp), targets)
        except ValueError as e:
            raise _fail(str(e)) from e
    console.print(
        f"restored {', '.join(done)} from {chosen} (previous files kept as *.before-restore)"
    )


# ---------------------------------------------------------------------- workflows

TEMPLATES = Path(__file__).resolve().parent / "workflows" / "templates"


@web_app.command("schema")
def web_schema(
    out: Annotated[
        Path | None, typer.Option("--out", "-o", help="Write to a file instead of stdout.")
    ] = None,
) -> None:
    """Print the JSON Schema of every payload the web reads (PRD v2.1.0 I6).

    The web generates its TypeScript types from it: `npm --prefix web run gen:types`.
    """
    from solosquad.web_api.schemas import schema_text

    text = schema_text()
    if out is None:
        typer.echo(text, nl=False)
    else:
        out.write_text(text, encoding="utf-8")


@workflows_app.command("templates")
def workflows_templates() -> None:
    """Workflow templates shipped with the engine."""
    for path in sorted(TEMPLATES.glob("*.yaml")):
        console.print(path.stem)


@workflows_app.command("add")
def workflows_add(
    template: Annotated[str, typer.Argument(help="Template name, e.g. monthly-pnl.")],
    solution: SolutionOpt = Path("."),
    org: OrgOpt = None,
) -> None:
    """Copy a template into the org — the org owns and edits its copy."""
    o = _pick_org(solution, org)
    src = TEMPLATES / f"{template}.yaml"
    if not src.is_file():
        raise _fail(f"no template {template!r} (see `solosquad workflows templates`)")
    dest = Solution(solution).org(o).root / "workflows" / src.name
    if dest.exists():
        raise _fail(f"{dest} exists")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    console.print(f"added {dest}")


@workflows_app.command("list")
def workflows_list(solution: SolutionOpt = Path("."), org: OrgOpt = None) -> None:
    """Workflows defined for an org, with any file that does not load."""
    from solosquad.workflows.definition import load_workflows

    o = _pick_org(solution, org)
    defs, errors = load_workflows(Solution(solution).org(o).root / "workflows")
    table = Table("workflow", "title", "steps", "schedule")
    for wf in defs.values():
        table.add_row(wf.name, wf.title, " → ".join(s.id for s in wf.steps), wf.schedule or "")
    console.print(table)
    for err in errors:
        console.print(f"[red]{escape(err)}[/red]")


# ---------------------------------------------------------------------- accounts


def _ask_password() -> str:
    password: str = typer.prompt("password (10+ characters)", hide_input=True)
    again: str = typer.prompt("again", hide_input=True)
    if password != again:
        raise _fail("passwords differ")
    return password


@accounts_app.command("create-owner")
def accounts_create_owner(
    username: Annotated[str, typer.Argument(help="Login name for the owner (대표).")],
    solution: SolutionOpt = Path("."),
    display: Annotated[str, typer.Option(help="Name shown in the web.")] = "",
) -> None:
    """The customer's owner account (done once by the FDE at setup), with its one-time code.

    The owner leads every org and workspace of the customer (decision 57 ⑵)."""
    store = _accounts(solution)
    from solosquad.web_api.accounts import Role

    try:
        user = store.create_user(username, _ask_password(), Role.OWNER, display=display)
    except ValueError as e:
        raise _fail(str(e)) from e
    uri = store.begin_totp(user.id)
    console.print(f"owner {user.username!r} created for the whole customer")
    console.print("add this to an authenticator app (or show it as a QR code):")
    console.print(escape(uri))
    code: str = typer.prompt("6-digit code from the app")
    if not store.confirm_totp(user.id, code):
        store.reset_totp(user.id)
        raise _fail("wrong code — run `solosquad accounts reset-totp` and enrol at first login")
    store.audit(None, "owner.create", f"{user.username} via CLI")
    console.print("[green]one-time code enrolled[/green]")


@accounts_app.command("list")
def accounts_list(solution: SolutionOpt = Path(".")) -> None:
    """Accounts of the customer and what each is assigned to."""
    store = _accounts(solution)
    table = Table("username", "role", "assigned", "2FA", "disabled")
    for u in store.users():
        scope = (
            "everything"
            if u.role.value == "owner"
            else ", ".join(
                f"{a.org}/{a.workspace or '*'} ({a.role.value})" for a in store.assignments(u.id)
            )
        )
        table.add_row(
            u.username,
            u.role.value,
            scope or "-",
            "yes" if u.has_totp else "no",
            "yes" if u.disabled else "",
        )
    console.print(table)


def _find_user(solution: Path, username: str) -> tuple[Any, Any]:
    store = _accounts(solution)
    match = [u for u in store.users() if u.username == username.lower()]
    if not match:
        raise _fail(f"no account {username!r}")
    return store, match[0]


@accounts_app.command("assign")
def accounts_assign(
    username: str,
    org: Annotated[str, typer.Option("--org", help="The org to give access to.")],
    solution: SolutionOpt = Path("."),
    workspace: Annotated[
        str | None,
        typer.Option("--workspace", "-w", help="Only this workspace (default: the whole org)."),
    ] = None,
    role: Annotated[str, typer.Option(help="owner (대표) or staff (직원) in that org")] = "staff",
    remove: Annotated[bool, typer.Option("--remove", help="Take the assignment away.")] = False,
) -> None:
    """Give a person an org (all its workspaces) or one workspace — or take it away (I39)."""
    from solosquad.web_api.accounts import Role

    store, user = _find_user(solution, username)
    try:
        found = Solution(solution).org(org)  # LayoutError for an org that is not there
        if workspace:
            found.workspace(workspace)
        if remove:
            store.set_assignments(
                user.id,
                [a for a in store.assignments(user.id) if (a.org, a.workspace) != (org, workspace)],
            )
        else:
            store.assign(user.id, org, workspace, Role(role))
    except (LayoutError, ValueError) as e:
        raise _fail(str(e)) from e
    where = f"{org}/{workspace or '*'}"
    store.audit(None, "user.assign", f"{user.username} {'-' if remove else '+'}{where} via CLI")
    console.print(f"{user.username!r}: {'removed from' if remove else 'assigned to'} {where}")


@accounts_app.command("reset-totp")
def accounts_reset_totp(username: str, solution: SolutionOpt = Path(".")) -> None:
    """Lost phone: clear the one-time code; the next login enrols a new one."""
    store, user = _find_user(solution, username)
    store.reset_totp(user.id)
    store.audit(None, "user.totp.reset", f"{user.username} via CLI")
    console.print(f"one-time code cleared for {user.username!r}")


@accounts_app.command("reset-passkeys")
def accounts_reset_passkeys(username: str, solution: SolutionOpt = Path(".")) -> None:
    """Lost phone: remove the account's passkeys and sign it out everywhere.

    The recovery path when the owner loses their own device — whoever can reach the
    server's shell can run it (PRD v2.1.0 K30)."""
    store, user = _find_user(solution, username)
    store.clear_passkeys(user.id)
    store.audit(None, "user.passkeys.reset", f"{user.username} via CLI")
    console.print(f"passkeys removed for {user.username!r} — sign in with password + code")


@accounts_app.command("set-password")
def accounts_set_password(username: str, solution: SolutionOpt = Path(".")) -> None:
    """Set a new password (ends that account's sessions)."""
    store, user = _find_user(solution, username)
    try:
        store.set_password(user.id, _ask_password())
    except ValueError as e:
        raise _fail(str(e)) from e
    store.audit(None, "user.password.reset", f"{user.username} via CLI")
    console.print(f"password changed for {user.username!r}")


@agents_app.command("watch")
def agents_watch(
    solution: SolutionOpt = Path("."), org: OrgOpt = None, workspace: WsOpt = None
) -> None:
    """Stream what the agents are doing (needs a running `solosquad serve`)."""
    client = _client(solution, org, workspace)
    if not isinstance(client, HttpClient):
        raise _fail(
            "no running instance — start one with `solosquad serve` or `solosquad service install`"
        )

    async def main() -> None:
        async for e in client.events():
            if e["event"] == "run.message":
                who = f"[dim]{e['thread_id']}[/dim] [bold]{e.get('agent')}[/bold]"
                console.print(f"{who} {escape(e['text'])}", end="")
            elif e["event"] == "run.update" and e.get("summary", {}).get("active_agent"):
                console.print(f"\n[dim]{e['thread_id']}[/dim] → {e['summary']['active_agent']}")
            else:
                console.print(f"\n[dim]{e.get('thread_id', '')}[/dim] {e['event']}")

    with contextlib.suppress(KeyboardInterrupt):
        _run(main())


# ---------------------------------------------------------------------- service


def _service(
    solution: Path, org: str | None, workspace: str | None, port: int
) -> tuple[ServiceSpec, Any]:
    """One service for the customer's engine server; `--org/--workspace` narrow what it runs."""
    _placement(org, workspace)
    if org:
        try:
            found = Solution(solution).org(org)
            if workspace:
                found.workspace(workspace)
        except LayoutError as e:
            raise _fail(str(e)) from e
    spec = ServiceSpec(solution.resolve(), org, workspace, port)
    return spec, plan(spec, Path.home())


@service_app.command("print")
def service_print(
    solution: SolutionOpt = Path("."), org: OrgOpt = None, workspace: WsOpt = None, port: int = 7420
) -> None:
    """Show the service file and commands for this machine without changing anything."""
    _, p = _service(solution, org, workspace, port)
    if p.path:
        console.print(f"[bold]{p.path}[/bold]\n{p.content}")
    for cmd in p.enable:
        console.print("$ " + " ".join(cmd))


@service_app.command("install")
def service_install(
    solution: SolutionOpt = Path("."), org: OrgOpt = None, workspace: WsOpt = None, port: int = 7420
) -> None:
    """Register and start the engine server as a login service (restarts on failure, reboot)."""
    _, p = _service(solution, org, workspace, port)
    if p.path and p.content:
        p.path.parent.mkdir(parents=True, exist_ok=True)
        p.path.write_text(p.content, encoding="utf-8")
    for cmd in p.enable:
        if cmd[:2] == ["loginctl", "enable-linger"]:
            # best effort: some distributions need root for this — say so, keep going
            if subprocess.run(cmd, check=False).returncode != 0:
                console.print(
                    "[yellow]could not enable lingering — run `sudo loginctl enable-linger"
                    " $USER` so the office starts at boot with nobody logged in[/yellow]"
                )
            continue
        subprocess.run(cmd, check=True)
    console.print("installed — `solosquad agents watch` to follow it")


@service_app.command("uninstall")
def service_uninstall(
    solution: SolutionOpt = Path("."), org: OrgOpt = None, workspace: WsOpt = None, port: int = 7420
) -> None:
    _, p = _service(solution, org, workspace, port)
    for cmd in p.disable:
        subprocess.run(cmd, check=False)
    if p.path:
        p.path.unlink(missing_ok=True)
    console.print("uninstalled")
