"""Secret store in the data folder (outside git, mode 0600).

§C3-6 prefers the OS keychain; v2.0 ships the file fallback only. The file sits under the
workspace data folder, never in the customer-solution repo (decision 37).
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path


class SecretStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def _read(self) -> dict[str, str]:
        if not self.path.is_file():
            return {}
        data = json.loads(self.path.read_text(encoding="utf-8"))
        return {str(k): str(v) for k, v in data.items()}

    def _write(self, data: dict[str, str]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.chmod(self.path, stat.S_IRUSR | stat.S_IWUSR)

    def get(self, ref: str) -> str | None:
        return self._read().get(ref)

    def set(self, ref: str, value: str) -> None:
        data = self._read()
        data[ref] = value
        self._write(data)

    def delete(self, ref: str) -> None:
        data = self._read()
        if data.pop(ref, None) is not None:
            self._write(data)
