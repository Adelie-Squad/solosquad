"""The demo server's caretaker — keeps the running copies in line with `demo_accounts`
(PRD §3.6.4 ④ · DM2).

- a visitor's runtime **starts at login** (`ensure`, called by the login) and **stops after
  `idle_minutes`** without them — the scripted harness is light, but a copy per account
  would otherwise run for every account ever issued;
- **처음 상태로** (`reset`, the visitor's button) and the CLI's `demo reset` (a row change the
  next round applies): the runtime stops, the copy is made again from the template, and it
  starts again if the visitor is here;
- the **nightly reset** (`nightly_reset`, default 04:00): every copy is made again;
- an **expired or revoked** account: its runtime stops and its sessions end; the copy goes
  `delete_after_days` after the expiry, its usage `usage_keep_days` after it.

The CLI never touches a copy a running server holds: it writes the row, this applies it.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
import time
from collections.abc import Callable
from typing import TYPE_CHECKING

from solosquad.demo import ORG_WORKSPACE, DemoConfig
from solosquad.demo.seed import reset_account, wipe_org
from solosquad.demo.store import DemoAccount, DemoStore
from solosquad.engine_server import EngineServer, set_holder
from solosquad.instance import Instance, start_instance, stop_instance
from solosquad.layout import EngineStore, LayoutError
from solosquad.web_api.org_store import open_org

if TYPE_CHECKING:
    from solosquad.web_api.app import AppConfig

log = logging.getLogger("solosquad.demo")


def step_recorder(store: DemoStore) -> Callable[[str, str, str, int, str, str], None]:
    """Scenario progress → usage (`scenario_step` · `scenario_done`), per demo account."""

    def record(org: str, tid: str, workflow: str, index: int, step: str, status: str) -> None:
        acct = next((a for a in store.accounts() if a.org == org), None)
        if acct is None:
            return
        store.record(acct.demo_id, "scenario_step", {"workflow": workflow, "step": index + 1,
                                                       "id": step})  # fmt: skip
        if status in ("done", "declined"):
            store.record(acct.demo_id, "scenario_done", {"workflow": workflow, "end": status})

    return record


class DemoSupervisor:
    def __init__(
        self,
        engine: EngineServer,
        store: DemoStore,
        config: DemoConfig,
        build: Callable[..., Instance],
        app: AppConfig | None = None,
    ) -> None:
        self.engine = engine
        self.store = store
        self.config = config
        self.build = build
        self.app = app
        self.last_nightly: str | None = None
        self._lock = asyncio.Lock()

    # ------------------------------------------------------------------ runtimes

    def _key(self, acct: DemoAccount) -> tuple[str, str]:
        return (acct.org, ORG_WORKSPACE)

    def running(self, acct: DemoAccount) -> bool:
        return self._key(acct) in self.engine.runtimes

    async def _start(self, acct: DemoAccount) -> None:
        key = self._key(acct)
        sol = self.engine.solution
        try:
            ws = sol.org(acct.org).workspace(ORG_WORKSPACE)
        except LayoutError:
            return
        inst = self.build(
            sol.root, acct.org, ORG_WORKSPACE, data_dir=EngineStore(self.engine.home).data_dir(ws)
        )
        await start_instance(inst)
        self.engine.runtimes[key] = inst
        self.engine.failed.pop(key, None)
        if key not in self.engine.placed:
            self.engine.placed.append(key)
        self.engine.orgs[acct.org] = open_org(sol, acct.org, self.engine.home)
        set_holder([inst], self.engine.accounts.company().holder())
        if self.app is not None:
            from solosquad.web_api.app import RuntimeView

            self.app.runtimes[key] = RuntimeView.of(inst)

    async def _stop(self, acct: DemoAccount, *, unplace: bool = False) -> None:
        key = self._key(acct)
        if self.app is not None:
            self.app.runtimes.pop(key, None)
        inst = self.engine.runtimes.pop(key, None)
        if unplace and key in self.engine.placed:
            self.engine.placed.remove(key)
        if inst is not None:
            with contextlib.suppress(Exception):
                await stop_instance(inst)

    async def ensure(self, acct: DemoAccount) -> None:
        """The visitor is here: their copy runs (built fresh first if a reset is due)."""
        async with self._lock:
            fresh = self.store.get(acct.demo_id) or acct
            if fresh.seeded > 0 and not fresh.ready:
                await self._apply_reset(fresh)
            elif fresh.ready and not self.running(fresh):
                await self._start(fresh)

    async def reset(self, acct: DemoAccount) -> None:
        """처음 상태로 — a fresh copy now; the visitor stays signed in."""
        async with self._lock:
            self.store.request_reset(acct.demo_id)
            fresh = self.store.get(acct.demo_id)
            assert fresh is not None
            await self._apply_reset(fresh)

    async def _apply_reset(self, acct: DemoAccount) -> None:
        await self._stop(acct)
        await reset_account(
            self.engine.solution, self.engine.home, self.store, self.engine.accounts, acct,
            build=self.build,
        )  # fmt: skip
        await self._start(acct)

    # ------------------------------------------------------------------ reconcile

    async def reconcile(self, now: float | None = None) -> dict[str, list[str]]:
        t = time.time() if now is None else now
        cfg = self.config
        done: dict[str, list[str]] = {"started": [], "stopped": [], "reset": [], "removed": []}
        async with self._lock:
            self.store.end_idle_sessions(cfg.idle_minutes * 60, now=t)
            self._nightly(t)
            for acct in self.store.accounts():
                running = self.running(acct)
                if not acct.active(t):
                    if running:
                        await self._stop(acct, unplace=True)
                        done["stopped"].append(acct.demo_id)
                    self.engine.accounts.revoke_user_sessions(acct.user_id)
                    gone_at = (acct.revoked or acct.expires) + cfg.delete_after_days * 86400
                    if t >= gone_at and (self.engine.solution.orgs_dir / acct.org).exists():
                        wipe_org(self.engine.solution, self.engine.home, acct,
                                 self.engine.accounts)  # fmt: skip
                        done["removed"].append(acct.demo_id)
                    if t >= acct.expires + cfg.usage_keep_days * 86400:
                        self.store.purge_usage(acct.demo_id)
                    continue
                last = self.store.last_seen(acct.demo_id) or 0.0
                here = t - last < cfg.idle_minutes * 60
                if acct.seeded > 0 and not acct.ready:
                    try:
                        await self._stop(acct)
                        await reset_account(
                            self.engine.solution, self.engine.home, self.store,
                            self.engine.accounts, acct, build=self.build,
                        )  # fmt: skip
                    except Exception:
                        log.exception("demo reset of %s failed", acct.demo_id)
                        continue
                    done["reset"].append(acct.demo_id)
                    running = False
                if acct.seeded > 0 and here and not running:
                    try:
                        await self._start(acct)
                    except Exception as e:
                        self.engine.failed[self._key(acct)] = f"{type(e).__name__}: {e}"
                        continue
                    done["started"].append(acct.demo_id)
                elif running and not here:
                    await self._stop(acct)
                    done["stopped"].append(acct.demo_id)
        return done

    def _nightly(self, now: float) -> None:
        at = self.config.nightly_reset
        if not at:
            return
        local = dt.datetime.fromtimestamp(now)
        today = local.date().isoformat()
        if self.last_nightly is None:
            # a server started after today's time does not reset at once
            self.last_nightly = today if local.strftime("%H:%M") >= at else ""
            return
        if self.last_nightly == today or local.strftime("%H:%M") < at:
            return
        self.last_nightly = today
        for acct in self.store.accounts():
            if acct.active(now) and acct.ready:
                self.store.request_reset(acct.demo_id)
                self.store.record(acct.demo_id, "reset", {"by": "nightly"}, now=now)

    async def run(self, every: float = 5.0) -> None:
        while True:
            try:
                await self.reconcile()
            except Exception:
                log.exception("demo reconcile failed")
            await asyncio.sleep(every)
