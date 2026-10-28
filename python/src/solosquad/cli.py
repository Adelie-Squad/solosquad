"""`solosquad` command line (v2). Sync face only — the engine itself is async (decision 23)."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table
from rich.tree import Tree

from solosquad import __version__
from solosquad.assets.bundle import find_bundle_root, load_bundle
from solosquad.layout import (
    LayoutError,
    Solution,
    WorkspaceType,
    scaffold_org,
    scaffold_solution,
    scaffold_workspace,
)

app = typer.Typer(no_args_is_help=True, add_completion=False)
console = Console()

BUNDLED_PACKAGE = "bundled"


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
        console.print("[red]no bundle found — pass --root[/red]")
        raise typer.Exit(1)
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
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1) from e
    console.print(f"created {path} — org {org!r}, workspace {workspace!r} ({ws_type.value})")


@app.command()
def layout(
    path: Annotated[Path, typer.Argument(help="Customer solution directory.")] = Path("."),
) -> None:
    """Show a customer solution's orgs and workspaces."""
    sol = Solution(path)
    try:
        lock = sol.engine_lock()
        meta = sol.meta()
    except LayoutError as e:
        console.print(f"[red]{e}[/red]")
        raise typer.Exit(1) from e
    tree = Tree(f"{path} · {meta.id} · engine {lock.version}")
    for o in sol.orgs():
        node = tree.add(f"org {o.name} · {o.lock().package}@{o.lock().version}")
        for ws in o.workspaces():
            node.add(f"workspace {ws.name} · {ws.config().type.value}")
    console.print(tree)
