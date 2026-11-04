"""24/7 on a local machine: register one workspace instance as an OS service ([4]).

macOS launchd (user agent), Linux systemd (user unit), Windows Task Scheduler (at logon,
restart on failure). The unit runs `solosquad serve` with explicit paths, so several
customers' offices can be registered side by side on one machine.
"""

from __future__ import annotations

import platform
import re
import shlex
import sys
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape


@dataclass(frozen=True)
class ServiceSpec:
    solution: Path
    org: str
    workspace: str
    port: int
    python: str = sys.executable

    @property
    def label(self) -> str:
        raw = f"{self.solution.name}.{self.org}.{self.workspace}"
        return "ai.solosquad." + re.sub(r"[^A-Za-z0-9.-]+", "-", raw)

    @property
    def argv(self) -> list[str]:
        return [
            self.python, "-m", "solosquad", "serve", "--solution", str(self.solution),
            "--org", self.org, "--workspace", self.workspace, "--port", str(self.port),
        ]  # fmt: skip


def launchd_plist(spec: ServiceSpec, log_dir: Path) -> str:
    args = "\n".join(f"    <string>{escape(a)}</string>" for a in spec.argv)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>{escape(spec.label)}</string>
  <key>ProgramArguments</key>
  <array>
{args}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>{escape(str(log_dir / "out.log"))}</string>
  <key>StandardErrorPath</key><string>{escape(str(log_dir / "err.log"))}</string>
</dict>
</plist>
"""


def systemd_unit(spec: ServiceSpec) -> str:
    return f"""[Unit]
Description=SoloSquad {spec.org}/{spec.workspace}
After=network-online.target

[Service]
ExecStart={shlex.join(spec.argv)}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
"""


def windows_task_command(spec: ServiceSpec) -> list[str]:
    run = " ".join(f'"{a}"' if " " in a else a for a in spec.argv)
    return [
        "schtasks",
        "/Create",
        "/F",
        "/SC",
        "ONLOGON",
        "/RL",
        "LIMITED",
        "/TN",
        spec.label,
        "/TR",
        run,
    ]


@dataclass(frozen=True)
class ServicePlan:
    path: Path | None
    content: str | None
    enable: list[list[str]]
    disable: list[list[str]]


def plan(spec: ServiceSpec, home: Path, system: str | None = None) -> ServicePlan:
    system = system or platform.system()
    if system == "Darwin":
        path = home / "Library" / "LaunchAgents" / f"{spec.label}.plist"
        logs = home / "Library" / "Logs" / "solosquad" / spec.label
        return ServicePlan(
            path,
            launchd_plist(spec, logs),
            [["mkdir", "-p", str(logs)], ["launchctl", "load", "-w", str(path)]],
            [["launchctl", "unload", "-w", str(path)]],
        )
    if system == "Linux":
        name = f"{spec.label}.service"
        path = home / ".config" / "systemd" / "user" / name
        return ServicePlan(
            path,
            systemd_unit(spec),
            [
                ["systemctl", "--user", "daemon-reload"],
                ["systemctl", "--user", "enable", "--now", name],
            ],
            [["systemctl", "--user", "disable", "--now", name]],
        )
    if system == "Windows":
        return ServicePlan(
            None,
            None,
            [windows_task_command(spec)],
            [["schtasks", "/Delete", "/F", "/TN", spec.label]],
        )
    raise RuntimeError(f"unsupported platform {system}")
