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
from solosquad.company_info import Company
from solosquad.layout import (
    EngineStore,
    LayoutError,
    Solution,
    WorkspaceType,
    display_name,
    scaffold_org,
    scaffold_solution,
    scaffold_workspace,
    solosquad_home,
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
server_app = typer.Typer(no_args_is_help=True, help="What this engine server is (서버).")
app.add_typer(server_app, name="server")
company_app = typer.Typer(no_args_is_help=True, help="The customer company (회사).")
app.add_typer(company_app, name="company")
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
        client = HttpClient(f"http://127.0.0.1:{info['port']}", info["token"], (o, w))
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
    display: Annotated[
        str | None, typer.Option("--display", help='Org name people read, e.g. "SpaceX".')
    ] = None,
    workspace_display: Annotated[
        str | None,
        typer.Option("--workspace-display", help='Workspace name people read, e.g. "HQ".'),
    ] = None,
    ws_type: Annotated[
        WorkspaceType | None,
        typer.Option("--type", help="Override where the server runs (default: detected)."),
    ] = None,
    server_country: Annotated[
        str | None, typer.Option("--server-country", help="ISO country of the server, e.g. KR")
    ] = None,
    cloud: Annotated[str | None, typer.Option(help="Cloud provider, e.g. aws · gcp · ncp")] = None,
    region: Annotated[str | None, typer.Option(help="Cloud region, e.g. ap-northeast-2")] = None,
    cloud_access: Annotated[
        str | None, typer.Option("--cloud-access", help="How the agency reaches it (no secrets)")
    ] = None,
) -> None:
    """Create core/, the first org and its first workspace. The server is detected; the
    options here only override what detection finds (core/server.yaml)."""
    bundle = find_bundle_root(Path(__file__).resolve().parent) or find_bundle_root(Path.cwd())
    try:
        display_name(display), display_name(workspace_display)  # refuse before writing anything
        sol = scaffold_solution(path, __version__, bundle / "user" if bundle else None, ws_type)
        new_org = scaffold_org(sol, org, BUNDLED_PACKAGE, __version__, display)
        scaffold_workspace(new_org, workspace, workspace_display)
        _server_overrides(sol, server_country, cloud, region, cloud_access)
    except (LayoutError, ValueError) as e:
        raise _fail(str(e)) from e
    console.print(f"created {path} — org {org!r}, workspace {workspace!r}")
    _print_server(sol)
    console.print("next: solosquad company set … , solosquad connections add … ,"
                  " then solosquad chat -s " + str(path))  # fmt: skip


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
    tree = Tree(f"{path} · {meta.id} · engine {lock.version} · server {server.facts().where}")
    for o in sol.orgs():
        shown = f" ({o.config().display_name})" if o.config().display_name else ""
        node = tree.add(f"org {o.name}{shown} · {o.lock().package}@{o.lock().version}")
        for ws in o.workspaces():
            placed = "" if server.placement.places(o.name, ws.name) else " · not placed here"
            ws_shown = f" ({ws.config().display_name})" if ws.config().display_name else ""
            node.add(f"workspace {ws.name}{ws_shown}{placed}")
    console.print(tree)


DisplayOpt = Annotated[
    str | None, typer.Option("--display", help="The name people read (default: the id).")
]


@add_app.command("org")
def add_org(
    name: str,
    solution: SolutionOpt = Path("."),
    workspace: str = "hq",
    display: DisplayOpt = None,
    workspace_display: Annotated[
        str | None, typer.Option("--workspace-display", help="The first workspace's name.")
    ] = None,
) -> None:
    """Create an org from the bundled org package (core is not touched)."""
    try:
        org = scaffold_org(Solution(solution), name, BUNDLED_PACKAGE, __version__, display)
        scaffold_workspace(org, workspace, workspace_display)
    except LayoutError as e:
        raise _fail(str(e)) from e
    console.print(f"org {name!r} with workspace {workspace!r}")


@add_app.command("workspace")
def add_workspace(
    name: str,
    org: Annotated[str, typer.Option("--org")],
    solution: SolutionOpt = Path("."),
    display: DisplayOpt = None,
) -> None:
    """Add a workspace (business unit) to an org — it runs on this customer's server, whose
    address, country and type are in core/server.yaml (I41)."""
    try:
        scaffold_workspace(Solution(solution).org(org), name, display)
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
) -> None:
    """Add a subscription login or an API key (decision 22). Keys go in with `set-secret`.
    The account holder is the customer company (회사) — `solosquad company set`."""
    from solosquad.routing.eligibility import judge, providers_reached

    holder = _accounts(solution).company().holder()
    model_list = [m for m in models.split(",") if m]
    if holder is None and providers_reached(provider, harness, model_list):
        raise _fail(
            "enter the company's country first: solosquad company set --country <ISO> (회사 소재지)"
        )
    country = Solution(solution).server_config(strict=False).facts().country
    verdict = judge(provider, harness, model_list, holder, country)
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


def _engine(solution: Path, include: list[str] | None = None, build: Any = None) -> EngineServer:
    """Every placed workspace's runtime — refuses on a server-settings conflict (C33) or a
    failed account move (C32), never on one broken workspace (K49)."""
    from solosquad.engine_server import build_engine
    from solosquad.storage import MigrationFailed

    try:
        if build is not None:
            return build_engine(solution, include=include, build=build)
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
    from solosquad.demo import is_demo, load_config

    demo = is_demo(Solution(solution))

    async def main() -> None:
        build = None
        demo_store = None
        if demo:
            from solosquad.demo.seed import demo_builder
            from solosquad.demo.store import DemoStore
            from solosquad.demo.supervisor import step_recorder

            demo_cfg = load_config(Solution(solution))
            demo_store = DemoStore(_accounts(solution).path)
            build = demo_builder(demo_cfg, step_recorder(demo_store))
            console.print("[yellow]DEMO MODE[/yellow] — scripted agents, settings read-only")
        engine = _engine(solution, include, build)
        resumed = await start_engine(engine)
        for (o, w), why in sorted(engine.failed.items()):
            console.print(f"[red]workspace {o}/{w} did not start:[/red] {escape(why)}")
        token = load_or_create_token(engine.data_dir)
        upkeep = asyncio.create_task(maintenance_loop(engine))
        caretaker: asyncio.Task[None] | None = None
        api = ApiServer.for_engine(engine, token, static_dir=_web_dist(), demo=demo_store)
        if demo and demo_store is not None and build is not None:
            from solosquad.demo.supervisor import DemoSupervisor

            sup = DemoSupervisor(engine, demo_store, demo_cfg, build, api.config)
            api.config.demo_control = sup
            await sup.reconcile()
            caretaker = asyncio.create_task(sup.run())
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
        if caretaker is not None:
            caretaker.cancel()
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


# ---------------------------------------------------------------------- 서버 · 회사 (2026-11-11)


def _server_overrides(
    sol: Solution,
    country: str | None,
    cloud: str | None,
    region: str | None,
    access: str | None,
) -> None:
    """The builder's overrides of the detected server facts, in core/server.yaml."""
    changes: dict[str, str | None] = {}
    for key, val in (("cloud", cloud), ("region", region), ("agency_access", access)):
        if val is not None:
            changes[key] = val.strip() or None
    if country is not None:
        changes["server_country"] = country.strip().upper() or None
    if changes:
        sol.update_server_config(**changes)


def _print_server(sol: Solution) -> None:
    facts = sol.server_config(strict=False).facts()
    table = Table("서버", "", "")
    for key in ("where", "cloud", "region", "country", "os", "version"):
        value = getattr(facts, key)
        table.add_row(key, str(value) if value else "-", facts.sources.get(key, ""))
    console.print(table)


@server_app.command("show")
def server_show(solution: SolutionOpt = Path(".")) -> None:
    """What this server is — detected, with core/server.yaml's overrides (the 서버 tab)."""
    _print_server(Solution(solution))


@server_app.command("set")
def server_set(
    solution: SolutionOpt = Path("."),
    country: Annotated[
        str | None, typer.Option("--country", help="ISO country of the server, e.g. KR ('' clears)")
    ] = None,
    cloud: Annotated[str | None, typer.Option(help="Cloud provider, e.g. aws · gcp · ncp")] = None,
    region: Annotated[str | None, typer.Option(help="Cloud region, e.g. ap-northeast-2")] = None,
    access: Annotated[
        str | None, typer.Option("--access", help="How the agency reaches it (no secrets)")
    ] = None,
) -> None:
    """Override detected facts — only when detection gets them wrong."""
    sol = Solution(solution)
    try:
        _server_overrides(sol, country, cloud, region, access)
    except (ValueError, LayoutError) as e:
        raise _fail(str(e)) from e
    _print_server(sol)


def _print_company(company: Company) -> None:
    table = Table("회사", "")
    for key in ("kind", "name", "representative", "country", "address", "controlled_by"):
        table.add_row(key, str(getattr(company, key) or "-"))
    table.add_row("complete", "[green]yes[/green]" if company.complete else "[yellow]no[/yellow]")
    console.print(table)


@company_app.command("show")
def company_show(solution: SolutionOpt = Path(".")) -> None:
    """The customer company (회사) — the account holder for the provider rules."""
    _print_company(_accounts(solution).company())


@company_app.command("set")
def company_set(
    solution: SolutionOpt = Path("."),
    kind: Annotated[
        str | None,
        typer.Option("--kind", help="corporation (법인) · sole_proprietor (개인 사업자)"),
    ] = None,
    name: Annotated[str | None, typer.Option("--name", help="법인명 or 상호")] = None,
    representative: Annotated[str | None, typer.Option("--representative", help="대표자")] = None,
    country: Annotated[
        str | None, typer.Option("--country", help="소재지 country, e.g. KR")
    ] = None,
    address: Annotated[str | None, typer.Option("--address", help="소재지 address")] = None,
    controlled_by: Annotated[
        str | None,
        typer.Option("--controlled-by", help="지배 회사 나라 (법인 only), e.g. CN"),
    ] = None,
) -> None:
    """Fill in or change the company; options left out keep their value."""
    from solosquad.company_info import validate_company

    store = _accounts(solution)
    current = store.company().public()
    given = {"kind": kind, "name": name, "representative": representative, "country": country,
             "address": address, "controlled_by": controlled_by}  # fmt: skip
    current.pop("complete")
    data = {**current, **{k: v for k, v in given.items() if v is not None}}
    try:
        company = store.set_company(validate_company(data))
    except ValueError as e:
        raise _fail(str(e)) from e
    store.audit(None, "company.update", "via CLI")
    _print_company(company)


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


calendar_app = typer.Typer(no_args_is_help=True, help="The account's calendar (일정).")
app.add_typer(calendar_app, name="calendar")


@calendar_app.command("demo")
def calendar_demo(
    org: Annotated[str, typer.Option("--org", help="The business the demo entries belong to.")],
    owner: Annotated[
        str | None, typer.Option("--owner", help="Username whose personal entries to add.")
    ] = None,
    solution: SolutionOpt = Path("."),
) -> None:
    """Add the decision-60 example (2차 모두의 창업 · 세부 항목 · 할 일 · 구분 · 태그) around
    today — for demos and screenshots, never on a customer's real calendar."""
    import datetime as dt

    from solosquad.calendars import CalendarStore, seed_demo

    store = _accounts(solution)
    uid = None
    if owner:
        found = [u for u in store.users() if u.username == owner.strip().lower()]
        if not found:
            raise _fail(f"no account {owner!r}")
        uid = found[0].id
    ids = seed_demo(CalendarStore(store.path), org, uid, today=dt.date.today().isoformat())
    console.print(f"added {len(ids)} calendar entries to {org!r}")


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


# ---------------------------------------------------------------------- demo (decision 62)

demo_app = typer.Typer(
    no_args_is_help=True,
    help="Demo server (server.yaml mode: demo): scripted scenarios, a copy per demo account.",
)
app.add_typer(demo_app, name="demo")

IdOpt = Annotated[str | None, typer.Option("--id", help="The demo id, e.g. samsungDemo.")]
IdArg = Annotated[str | None, typer.Argument(help="The demo id (or --id).")]


def _demo_solution(solution: Path) -> Solution:
    from solosquad.demo import is_demo

    sol = Solution(solution)
    if not is_demo(sol):
        raise _fail(f"{solution} is not a demo server (server.yaml mode: demo) — demo init")
    return sol


def _server_running(solution: Path) -> bool:
    sf = server_file(_customer_dir(solution))
    if not sf.is_file():
        return False
    try:
        pid = int(json.loads(sf.read_text(encoding="utf-8"))["pid"])
        os.kill(pid, 0)
    except (OSError, ValueError, KeyError):
        return False
    return True


def _when(ts: float | None) -> str:
    import time as _t

    return _t.strftime("%Y-%m-%d %H:%M", _t.localtime(ts)) if ts else "-"


def _one_id(arg: str | None, opt: str | None) -> str | None:
    if arg and opt and arg != opt:
        raise _fail("give the demo id once (argument or --id)")
    return arg or opt


@demo_app.command("init")
def demo_init(
    path: Annotated[Path, typer.Argument(help="Directory for the new demo server's solution.")],
    step_seconds: Annotated[float, typer.Option(help="Seconds per scenario step.")] = 4.0,
    nightly_reset: Annotated[
        str, typer.Option(help="HH:MM — every copy made again daily; 'off' to turn it off.")
    ] = "04:00",
    marketing_url: Annotated[
        str | None, typer.Option(help="The marketing site — the demo login form's Origin.")
    ] = None,
) -> None:
    """A demo server: server.yaml mode: demo, the example company 모아 리빙, an empty
    connection pool, the scenario template. Each demo account gets its own copy when issued."""
    from solosquad.demo import DemoConfig
    from solosquad.demo.seed import ensure_company, init_solution

    try:
        cfg = DemoConfig(
            step_seconds=step_seconds,
            nightly_reset=None if nightly_reset == "off" else nightly_reset,
            marketing_url=marketing_url,
        )
        init_solution(path, cfg)
    except (LayoutError, ValueError) as e:
        raise _fail(str(e)) from e
    ensure_company(_accounts(path))
    console.print(f"demo server created at {path} (SOLOSQUAD_HOME={solosquad_home()})")
    console.print("next: solosquad demo issue --id <slug>Demo --inquiry <id> --company-no <n>"
                  f" -s {path} · solosquad serve -s {path}")  # fmt: skip


@demo_app.command("issue")
def demo_issue(
    demo_id: IdArg = None,
    id_: IdOpt = None,
    inquiry: Annotated[str, typer.Option("--inquiry", help="The inquiry this demo answers.")] = "",
    company_no: Annotated[
        str,
        typer.Option(
            "--company-no",
            help="The inquiry's company registration number (사업자 · 법인등록번호, or another"
            " country's) — asked for at the demo login with the id and password.",
        ),
    ] = "",
    days: Annotated[int | None, typer.Option(help="Days until it expires (default 14).")] = None,
    expires: Annotated[str | None, typer.Option(help="Or: 14d · 48h · 2w · 2026-12-31")] = None,
    locale: Annotated[str, typer.Option(help="The visitor's screen language.")] = "ko",
    name: Annotated[str, typer.Option("--name", help="Label shown in the web.")] = "",
    solution: SolutionOpt = Path("."),
) -> None:
    """A demo account (대표 of its own fresh copy) → its password, printed once (16 chars,
    only the hash is kept)."""
    from solosquad.demo import load_config
    from solosquad.demo.seed import create_account, open_stores, seed_account
    from solosquad.demo.store import parse_expiry
    from solosquad.web_api.accounts import LOCALES

    sol = _demo_solution(solution)
    wanted = _one_id(demo_id, id_)
    if not wanted or not inquiry or not company_no.strip():
        raise _fail("give the demo id (--id samsungDemo), --inquiry <id> and --company-no <number>")
    if locale not in LOCALES:
        raise _fail(f"locale must be one of {list(LOCALES)}")
    cfg = load_config(sol)
    accounts, store = open_stores(sol)
    try:
        until = parse_expiry(expires or f"{days or cfg.default_days}d")
        acct, password = create_account(
            sol, store, accounts, wanted, inquiry, until, name, locale, company_no=company_no
        )
    except ValueError as e:
        raise _fail(str(e)) from e
    _run(seed_account(sol, solosquad_home(), acct, accounts))
    store.mark_seeded(acct.demo_id, acct.generation)
    console.print(f"[green]issued {acct.demo_id}[/green] · inquiry {acct.inquiry_id} ·"
                  f" expires {_when(acct.expires)}")  # fmt: skip
    console.print(f"company no: {acct.company_no}")
    console.print(f"login id: {acct.demo_id}")
    console.print(f"password: [bold]{password}[/bold]  (shown once — only its hash is kept)")
    # stable lines for the marketing admin's script (ssh demo 'solosquad demo issue …')
    typer.echo(f"demo_id={acct.demo_id}")
    typer.echo(f"password={password}")
    typer.echo(f"expires={_when(acct.expires)}")
    typer.echo(f"company_no={acct.company_no}")


@demo_app.command("list")
def demo_list(solution: SolutionOpt = Path(".")) -> None:
    """Demo accounts with their inquiry, company number, status and expiry."""
    from solosquad.demo.seed import open_stores

    _, store = open_stores(_demo_solution(solution))
    table = Table(
        "demo id", "inquiry", "company no", "label", "status", "expires", "issued", "last reset"
    )
    for a in store.accounts():
        table.add_row(a.demo_id, a.inquiry_id, a.company_no or "-", a.label, a.status(),
                      _when(a.expires), _when(a.created), _when(a.last_reset))  # fmt: skip
    console.print(table)


def _demo_get(store: Any, demo_id: str | None) -> Any:
    acct = store.get(demo_id or "")
    if acct is None:
        raise _fail(f"no demo account {demo_id!r}")
    return acct


@demo_app.command("revoke")
def demo_revoke(
    demo_id: IdArg = None, id_: IdOpt = None, solution: SolutionOpt = Path(".")
) -> None:
    """End a demo now: the login stops working and its copy is removed (usage stays)."""
    from solosquad.demo.seed import open_stores, wipe_org

    sol = _demo_solution(solution)
    accounts, store = open_stores(sol)
    acct = _demo_get(store, _one_id(demo_id, id_))
    store.revoke(acct.demo_id)
    accounts.set_disabled(acct.user_id, True)
    accounts.audit(None, "demo.revoke", acct.demo_id)
    if _server_running(solution):
        # the running server stops the runtime and removes the copy itself
        console.print(f"revoked {acct.demo_id} — the server removes its copy within seconds")
        return
    wipe_org(sol, solosquad_home(), acct, accounts)
    console.print(f"revoked {acct.demo_id}")


@demo_app.command("extend")
def demo_extend(
    demo_id: IdArg = None,
    id_: IdOpt = None,
    days: Annotated[int | None, typer.Option(help="Days from now.")] = None,
    expires: Annotated[str | None, typer.Option(help="Or: 7d · 48h · 2026-12-31")] = None,
    solution: SolutionOpt = Path("."),
) -> None:
    """Move the expiry (an expired account can log in again)."""
    from solosquad.demo.seed import open_stores
    from solosquad.demo.store import parse_expiry

    accounts, store = open_stores(_demo_solution(solution))
    acct = _demo_get(store, _one_id(demo_id, id_))
    if acct.revoked is not None:
        raise _fail(f"{acct.demo_id} was revoked — issue a new id")
    if not (days or expires):
        raise _fail("give --days or --expires")
    try:
        store.extend(acct.demo_id, parse_expiry(expires or f"{days}d"))
    except ValueError as e:
        raise _fail(str(e)) from e
    accounts.audit(None, "demo.extend", f"{acct.demo_id} → {expires or days}")
    console.print(f"{acct.demo_id} expires {_when(_demo_get(store, acct.demo_id).expires)}")


@demo_app.command("reset")
def demo_reset(
    demo_id: IdArg = None,
    id_: IdOpt = None,
    all_: Annotated[bool, typer.Option("--all", help="Every active demo account.")] = False,
    solution: SolutionOpt = Path("."),
) -> None:
    """A fresh copy of the example company (처음 상태로) — usage stays. With a server
    running it applies the reset within seconds; otherwise it is done here. The server
    resets every copy at `nightly_reset` itself; `demo reset --all` is the cron fallback."""
    from solosquad.demo.seed import open_stores, reset_account

    sol = _demo_solution(solution)
    accounts, store = open_stores(sol)
    wanted = _one_id(demo_id, id_)
    if all_ == (wanted is not None):
        raise _fail("give one demo id or --all")
    targets = [a for a in store.accounts() if a.active()] if all_ else [_demo_get(store, wanted)]
    running = _server_running(solution)
    for acct in targets:
        store.request_reset(acct.demo_id)
        store.record(acct.demo_id, "reset", {"by": "cli"})
        if not running:
            _run(
                reset_account(
                    sol, solosquad_home(), store, accounts, _demo_get(store, acct.demo_id)
                )
            )
        accounts.audit(None, "demo.reset", acct.demo_id)
    how = "the running server applies it" if running else "done"
    console.print(f"reset {len(targets)} demo account(s) — {how}")


@demo_app.command("usage")
def demo_usage(
    demo_id: IdArg = None,
    id_: IdOpt = None,
    all_: Annotated[bool, typer.Option("--all", help="Every demo account.")] = False,
    fmt: Annotated[str, typer.Option("--format", help="table · csv")] = "table",
    as_csv: Annotated[bool, typer.Option("--csv", help="Same as --format csv.")] = False,
    events: Annotated[bool, typer.Option("--events", help="Every event, not the summary.")] = False,
    since: Annotated[str | None, typer.Option(help="Only from this day (2026-11-01).")] = None,
    solution: SolutionOpt = Path("."),
) -> None:
    """How a demo was used — logins, sessions, screens, scenarios, approval clicks, locked
    settings clicked, requests (never their text) — per account, with its inquiry id to join
    with the marketing site's inquiry on the agency's own machine."""
    import datetime as dt

    from solosquad.demo.seed import open_stores
    from solosquad.demo.store import events_csv, summaries_csv

    _, store = open_stores(_demo_solution(solution))
    wanted = _one_id(demo_id, id_)
    if all_ == (wanted is not None):
        raise _fail("give one demo id or --all")
    csv_out = as_csv or fmt == "csv"
    start = dt.datetime.fromisoformat(since).timestamp() if since else 0.0
    accts = store.accounts() if all_ else [_demo_get(store, wanted)]
    if events:
        rows = [e for a in accts for e in store.events(a.demo_id, since=start)]
        if csv_out:
            typer.echo(events_csv(rows, {a.demo_id: a.inquiry_id for a in accts}), nl=False)
            return
        for e in rows:
            console.print(f"{_when(e['ts'])}  {e['demo_id']}  {e['kind']}  "
                          f"{escape(json.dumps(e['detail'], ensure_ascii=False))}")  # fmt: skip
        return
    summaries = [store.summary(a, since=start) for a in accts]
    if csv_out:
        typer.echo(summaries_csv(summaries), nl=False)
        return
    for u in summaries:
        console.print(f"[bold]{u['demo_id']}[/bold] · inquiry {u['inquiry_id']} · {u['status']}"
                      f" · expires {_when(u['expires'])}")  # fmt: skip
        console.print(f"  first login {_when(u['first_login'])} (+{u['days_to_first_login']}d) ·"
                      f" logins {u['logins']} · sessions {u['sessions']} ·"
                      f" {u['total_minutes']} min · last seen {_when(u['last_seen'])}")  # fmt: skip
        console.print(f"  scenarios started {u['scenario_starts']} · finished"
                      f" {', '.join(u['scenarios_done']) or '-'} · approvals"
                      f" {u['approvals_approved']} yes / {u['approvals_declined']} no ·"
                      f" requests {u['prompts']} ({u['prompts_matched']} matched)")  # fmt: skip
        if u["blocked"]:
            console.print("  locked settings clicked " + ", ".join(
                f"{k} {v}" for k, v in u["blocked"].items()))  # fmt: skip
        if u["screens"]:
            console.print("  screens " + ", ".join(f"{k} {v}" for k, v in u["screens"].items()))
