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
from typing import Annotated, Any

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
from solosquad.routing import (
    Connection,
    ConnectionKind,
    SecretStore,
    load_connections,
    save_connections,
)
from solosquad.service import ServiceSpec, plan

app = typer.Typer(no_args_is_help=True, add_completion=False)
add_app = typer.Typer(no_args_is_help=True, help="Add an org (business) or a workspace (office).")
conn_app = typer.Typer(
    no_args_is_help=True, help="LLM connections: subscription logins and API keys."
)
agents_app = typer.Typer(no_args_is_help=True, help="Watch the agents work.")
service_app = typer.Typer(no_args_is_help=True, help="Run a workspace 24/7 as an OS service.")
app.add_typer(add_app, name="add")
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


def _data_dir(solution: Path, org: str, workspace: str) -> Path:
    return EngineStore(solosquad_home()).data_dir(Solution(solution).org(org).workspace(workspace))


def _client(solution: Path, org: str | None, workspace: str | None) -> Client:
    o, w = _pick(solution, org, workspace)
    sf = server_file(_data_dir(solution, o, w))
    if sf.is_file():
        info = json.loads(sf.read_text(encoding="utf-8"))
        client = HttpClient(f"http://127.0.0.1:{info['port']}", info["token"])
        try:
            client._call("GET", "/health")
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
) -> None:
    """Create core/, the first org and its first workspace."""
    bundle = find_bundle_root(Path(__file__).resolve().parent) or find_bundle_root(Path.cwd())
    try:
        sol = scaffold_solution(path, __version__, bundle / "user" if bundle else None)
        new_org = scaffold_org(sol, org, BUNDLED_PACKAGE, __version__)
        scaffold_workspace(new_org, workspace, ws_type)
    except LayoutError as e:
        raise _fail(str(e)) from e
    console.print(f"created {path} — org {org!r}, workspace {workspace!r} ({ws_type.value})")
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
    tree = Tree(f"{path} · {meta.id} · engine {lock.version}")
    for o in sol.orgs():
        node = tree.add(f"org {o.name} · {o.lock().package}@{o.lock().version}")
        for ws in o.workspaces():
            node.add(f"workspace {ws.name} · {ws.config().type.value}")
    console.print(tree)


@add_app.command("org")
def add_org(
    name: str,
    solution: SolutionOpt = Path("."),
    workspace: str = "hq",
    ws_type: Annotated[WorkspaceType, typer.Option("--type")] = WorkspaceType.LOCAL,
) -> None:
    """Create an org from the bundled org package (core is not touched)."""
    try:
        org = scaffold_org(Solution(solution), name, BUNDLED_PACKAGE, __version__)
        scaffold_workspace(org, workspace, ws_type)
    except LayoutError as e:
        raise _fail(str(e)) from e
    console.print(f"org {name!r} with workspace {workspace!r}")


@add_app.command("workspace")
def add_workspace(
    name: str,
    org: Annotated[str, typer.Option("--org")],
    solution: SolutionOpt = Path("."),
    ws_type: Annotated[WorkspaceType, typer.Option("--type")] = WorkspaceType.LOCAL,
) -> None:
    """Add an office (workspace) to an org."""
    try:
        scaffold_workspace(Solution(solution).org(org), name, ws_type)
    except LayoutError as e:
        raise _fail(str(e)) from e
    console.print(f"workspace {name!r} ({ws_type.value}) in org {org!r}")


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
    """Add a subscription login or an API key (decision 22). Keys go in with `set-secret`."""
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
    """Store an API key in the workspace data folder (outside git, mode 0600)."""
    o, w = _pick(solution, org, workspace)
    value = typer.prompt(f"key for {id}", hide_input=True)
    SecretStore(_data_dir(solution, o, w) / "secrets.json").set(id, value)
    console.print(f"{id}: key stored")


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


@app.command()
def serve(
    solution: SolutionOpt = Path("."),
    org: OrgOpt = None,
    workspace: WsOpt = None,
    port: int = 7420,
    host: str = "127.0.0.1",
) -> None:
    """Run one workspace 24/7: run manager, crons, and the local JSON API."""
    from solosquad.instance import build_instance, start_instance
    from solosquad.server import ApiServer, load_or_create_token

    o, w = _pick(solution, org, workspace)

    async def main() -> None:
        inst = build_instance(solution, o, w)
        resumed = await start_instance(inst)
        token = load_or_create_token(inst.ctx.data_dir)
        api = ApiServer(inst.manager, inst.ledger, token)
        bound = await api.start(host, port)
        sf = server_file(inst.ctx.data_dir)
        sf.write_text(
            json.dumps({"port": bound, "token": token, "pid": os.getpid()}), encoding="utf-8"
        )
        sf.chmod(0o600)
        console.print(f"serving {o}/{w} on http://{host}:{bound} · resumed {len(resumed)} run(s)")
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(sig, stop.set)
        await stop.wait()
        await api.stop()
        await inst.manager.stop()
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
    o, w = _pick(solution, org, workspace)
    spec = ServiceSpec(solution.resolve(), o, w, port)
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
    """Register and start the workspace as a login service (restarts on failure and reboot)."""
    _, p = _service(solution, org, workspace, port)
    if p.path and p.content:
        p.path.parent.mkdir(parents=True, exist_ok=True)
        p.path.write_text(p.content, encoding="utf-8")
    for cmd in p.enable:
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
