"""Daily snapshots to the customer's own object storage (decision 54 · PRD v2.1.0 I29 · I36).

`storage.backup` makes consistent copies of `org.db` and `office.db`; this module ships
that folder off the VM — to the customer's bucket, in the customer's account (P1) — and
keeps `keep_days` (30) of them. Any S3-compatible store works: AWS S3, NCP Object
Storage, Alibaba OSS, GCS interoperability, Cloudflare R2, MinIO. The client signs
requests with AWS Signature V4 using the standard library only (decision 13); keys live
in the office's secret store as `ACCESS_KEY:SECRET_KEY`, never in a file in git.

A `dir` target copies to a folder instead (a mounted disk, or tests).

    snapshot:                         # workspace.yaml
      type: s3
      endpoint: https://s3.ap-northeast-2.amazonaws.com
      region: ap-northeast-2
      bucket: moa-solosquad-backup
      prefix: solosquad
      secret_ref: snapshot-s3
      keep_days: 30
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import json
import shutil
import sqlite3
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel

EMPTY_SHA256 = hashlib.sha256(b"").hexdigest()
STAMP = "%Y%m%dT%H%M%SZ"


class SnapshotTarget(BaseModel):
    type: Literal["s3", "dir"] | None = None
    endpoint: str | None = None
    region: str = "us-east-1"
    bucket: str | None = None
    prefix: str = "solosquad"
    secret_ref: str | None = None
    path: str | None = None
    keep_days: int = 30


# ---------------------------------------------------------------------- SigV4


def _h(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


def sign_v4(
    method: str,
    url: str,
    headers: dict[str, str],
    payload_sha256: str,
    *,
    access_key: str,
    secret_key: str,
    region: str,
    service: str = "s3",
    when: dt.datetime | None = None,
) -> dict[str, str]:
    """→ `headers` plus `x-amz-date`, `x-amz-content-sha256` and `Authorization`."""
    now = (when or dt.datetime.now(dt.UTC)).astimezone(dt.UTC)
    amz_date, day = now.strftime(STAMP), now.strftime("%Y%m%d")
    parts = urllib.parse.urlsplit(url)
    out = {k.lower(): v.strip() for k, v in headers.items()}
    out["host"] = parts.netloc
    out["x-amz-date"] = amz_date
    out["x-amz-content-sha256"] = payload_sha256
    canonical_query = "&".join(
        f"{urllib.parse.quote(k, safe='-_.~')}={urllib.parse.quote(v, safe='-_.~')}"
        for k, v in sorted(urllib.parse.parse_qsl(parts.query, keep_blank_values=True))
    )
    signed = ";".join(sorted(out))
    canonical = "\n".join(
        [
            method,
            urllib.parse.quote(parts.path or "/", safe="/-_.~"),
            canonical_query,
            "".join(f"{k}:{out[k]}\n" for k in sorted(out)),
            signed,
            payload_sha256,
        ]
    )
    scope = f"{day}/{region}/{service}/aws4_request"
    to_sign = "\n".join(
        ["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()]
    )
    key = _h(_h(_h(_h(f"AWS4{secret_key}".encode(), day), region), service), "aws4_request")
    signature = hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()
    out["authorization"] = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed},"
        f" Signature={signature}"
    )
    return out


@dataclass
class S3Client:
    endpoint: str
    bucket: str
    region: str
    access_key: str
    secret_key: str

    def _url(self, key: str = "", query: str = "") -> str:
        base = self.endpoint.rstrip("/")
        path = (
            f"/{self.bucket}/{urllib.parse.quote(key, safe='/-_.~')}" if key else f"/{self.bucket}"
        )
        return f"{base}{path}{'?' + query if query else ''}"

    def _send(self, method: str, url: str, body: bytes = b"") -> bytes:
        digest = hashlib.sha256(body).hexdigest() if body else EMPTY_SHA256
        headers = sign_v4(
            method, url, {}, digest,
            access_key=self.access_key, secret_key=self.secret_key, region=self.region,
        )  # fmt: skip
        req = urllib.request.Request(url, data=body or None, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=120) as resp:
            return bytes(resp.read())

    def get(self, key: str) -> bytes:
        return self._send("GET", self._url(key))

    def put(self, key: str, body: bytes) -> None:
        self._send("PUT", self._url(key), body)

    def delete(self, key: str) -> None:
        self._send("DELETE", self._url(key))

    def list(self, prefix: str) -> list[str]:
        keys: list[str] = []
        token: str | None = None
        while True:
            q = {"list-type": "2", "prefix": prefix}
            if token:
                q["continuation-token"] = token
            raw = self._send("GET", self._url(query=urllib.parse.urlencode(sorted(q.items()))))
            root = ET.fromstring(raw)
            ns = root.tag.split("}")[0] + "}" if root.tag.startswith("{") else ""
            keys += [el.text or "" for el in root.iter(f"{ns}Key")]
            nxt = root.find(f"{ns}NextContinuationToken")
            if nxt is None or not nxt.text:
                return keys
            token = nxt.text


# ---------------------------------------------------------------------- ship · prune


def _stamp_of(name: str) -> dt.datetime | None:
    try:
        return dt.datetime.strptime(name, STAMP).replace(tzinfo=dt.UTC)
    except ValueError:
        return None


def ship(
    backup_dir: Path,
    target: SnapshotTarget,
    scope: str,
    *,
    secret: Callable[[str], str | None],
    now: float | None = None,
) -> dict[str, Any]:
    """Upload one `storage.backup` folder under `<prefix>/<scope>/<UTC stamp>/` and prune."""
    if target.type is None:
        raise ValueError("no snapshot target configured (workspace.yaml `snapshot:`)")
    t = dt.datetime.fromtimestamp(time.time() if now is None else now, dt.UTC)
    stamp = t.strftime(STAMP)
    base = f"{target.prefix.strip('/')}/{scope.strip('/')}"
    files = sorted(p for p in backup_dir.iterdir() if p.is_file())
    cutoff = t - dt.timedelta(days=target.keep_days)
    pruned: list[str] = []
    if target.type == "dir":
        if not target.path:
            raise ValueError("a dir snapshot target needs `path`")
        root = Path(target.path) / base
        dest = root / stamp
        dest.mkdir(parents=True, exist_ok=True)
        for f in files:
            shutil.copy2(f, dest / f.name)
        for old in root.iterdir() if root.is_dir() else []:
            when = _stamp_of(old.name)
            if when is not None and when < cutoff:
                shutil.rmtree(old)
                pruned.append(old.name)
        return {"target": "dir", "location": str(dest), "files": len(files), "pruned": pruned}
    if not (target.endpoint and target.bucket and target.secret_ref):
        raise ValueError("an s3 snapshot target needs endpoint, bucket and secret_ref")
    pair = secret(target.secret_ref)
    if not pair or ":" not in pair:
        raise ValueError(f"secret {target.secret_ref!r} must hold ACCESS_KEY:SECRET_KEY")
    access, secret_key = pair.split(":", 1)
    client = S3Client(target.endpoint, target.bucket, target.region, access, secret_key)
    for f in files:
        client.put(f"{base}/{stamp}/{f.name}", f.read_bytes())
    for key in client.list(f"{base}/"):
        rest = key[len(base) + 1 :]
        when = _stamp_of(rest.split("/", 1)[0])
        if when is not None and when < cutoff:
            client.delete(key)
            pruned.append(key)
    return {
        "target": "s3",
        "location": f"s3://{target.bucket}/{base}/{stamp}/",
        "files": len(files),
        "pruned": pruned,
    }


# ---------------------------------------------------------------------- restore


def fetch(
    target: SnapshotTarget, scope: str, stamp: str | None, dest: Path,
    *, secret: Callable[[str], str | None],
) -> str:  # fmt: skip
    """Download one snapshot (the newest when `stamp` is None) into `dest` → its stamp."""
    base = f"{target.prefix.strip('/')}/{scope.strip('/')}"
    dest.mkdir(parents=True, exist_ok=True)
    if target.type == "dir":
        root = Path(target.path or "") / base
        stamps = (
            sorted(p.name for p in root.iterdir() if _stamp_of(p.name)) if root.is_dir() else []
        )
        chosen = stamp or (stamps[-1] if stamps else None)
        if chosen is None or not (root / chosen).is_dir():
            raise KeyError(f"no snapshot {stamp or ''} under {root}")
        for f in (root / chosen).iterdir():
            shutil.copy2(f, dest / f.name)
        return chosen
    if target.type != "s3" or not (target.endpoint and target.bucket and target.secret_ref):
        raise ValueError("no restorable snapshot target configured")
    pair = secret(target.secret_ref) or ""
    access, _, secret_key = pair.partition(":")
    client = S3Client(target.endpoint, target.bucket, target.region, access, secret_key)
    keys = client.list(f"{base}/")
    stamps = sorted({k[len(base) + 1 :].split("/", 1)[0] for k in keys} - {""})
    chosen = stamp or (stamps[-1] if stamps else None)
    if chosen is None or chosen not in stamps:
        raise KeyError(f"no snapshot {stamp or ''} under s3://{target.bucket}/{base}/")
    for key in keys:
        if key.startswith(f"{base}/{chosen}/"):
            (dest / key.rsplit("/", 1)[1]).write_bytes(client.get(key))
    return chosen


def verify(folder: Path) -> dict[str, Any]:
    """Check every file against the manifest's SHA-256 — a corrupt copy is never restored."""
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    for entry in manifest["files"]:
        got = hashlib.sha256((folder / entry["file"]).read_bytes()).hexdigest()
        if got != entry["sha256"]:
            raise ValueError(f"{entry['file']} does not match its manifest checksum")
    return dict(manifest)


def restore(folder: Path, targets: dict[str, Path]) -> list[str]:
    """Replace the live databases with a verified snapshot; the current files are kept aside
    as `<name>.before-restore` so a restore can itself be undone."""
    manifest = verify(folder)
    done = []
    for entry in manifest["files"]:
        dest = targets.get(entry["name"])
        if dest is None:
            continue
        if dest.exists():
            # fold the write-ahead log into the file first, or the copy kept aside misses
            # the newest writes
            live = sqlite3.connect(str(dest))
            try:
                live.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                live.close()
            shutil.copy2(dest, dest.with_suffix(dest.suffix + ".before-restore"))
        for side in ("-wal", "-shm"):
            Path(f"{dest}{side}").unlink(missing_ok=True)
        shutil.copy2(folder / entry["file"], dest)
        done.append(entry["name"])
    return done
