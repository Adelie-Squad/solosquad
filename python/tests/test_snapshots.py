"""Daily snapshots to the customer's own bucket (decision 54 · I29 · I36)."""

from __future__ import annotations

import datetime as dt
import threading
import time
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
from typer.testing import CliRunner

from solosquad.cli import app
from solosquad.instance import build_instance
from solosquad.layout import EngineStore, Solution, solosquad_home
from solosquad.maintenance import run_snapshot
from solosquad.snapshots import EMPTY_SHA256, STAMP, SnapshotTarget, ship, sign_v4

AK, SK = "AKIAIOSFODNN7EXAMPLE", "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"


def test_sigv4_matches_the_aws_documented_example() -> None:
    # AWS S3 docs, "Signature Calculations … Example: GET Object"
    out = sign_v4(
        "GET",
        "https://examplebucket.s3.amazonaws.com/test.txt",
        {"Range": "bytes=0-9"},
        EMPTY_SHA256,
        access_key=AK,
        secret_key=SK,
        region="us-east-1",
        when=dt.datetime(2013, 5, 24, tzinfo=dt.UTC),
    )
    assert out["authorization"] == (
        "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request,"
        " SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,"
        " Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
    )


def _backup(tmp: Path) -> Path:
    d = tmp / "bk"
    d.mkdir()
    for name in ("org.db", "office.db", "manifest.json"):
        (d / name).write_bytes(name.encode())
    return d


def test_dir_target_ships_and_prunes(tmp_path: Path) -> None:
    target = SnapshotTarget(type="dir", path=str(tmp_path / "vault"), keep_days=30)
    old = (
        tmp_path
        / "vault/solosquad/sol/moa/hq"
        / (dt.datetime.now(dt.UTC) - dt.timedelta(days=40)).strftime(STAMP)
    )
    old.mkdir(parents=True)
    keep = old.parent / "notes"  # anything that is not a snapshot stamp is left alone
    keep.mkdir()
    result = ship(_backup(tmp_path), target, "sol/moa/hq", secret=lambda _r: None)
    assert result["files"] == 3 and result["pruned"] == [old.name]
    assert sorted(p.name for p in Path(result["location"]).iterdir()) == [
        "manifest.json",
        "office.db",
        "org.db",
    ]
    assert not old.exists() and keep.exists()


@pytest.fixture
def fake_s3() -> Iterator[tuple[str, dict[str, bytes]]]:
    """A tiny path-style S3 that re-signs every request and refuses a wrong signature."""
    objects: dict[str, bytes] = {}

    class Handler(BaseHTTPRequestHandler):
        def _check(self, body: bytes) -> bool:
            url = f"http://{self.headers['Host']}{self.path}"
            when = dt.datetime.strptime(self.headers["x-amz-date"], STAMP).replace(tzinfo=dt.UTC)
            import hashlib

            again = sign_v4(self.command, url, {}, hashlib.sha256(body).hexdigest() if body else EMPTY_SHA256,
                            access_key=AK, secret_key=SK, region="ap-northeast-2", when=when)  # fmt: skip
            if again["authorization"] != self.headers["Authorization"]:
                self.send_response(403)
                self.end_headers()
                return False
            return True

        def do_PUT(self) -> None:
            body = self.rfile.read(int(self.headers["Content-Length"]))
            if self._check(body):
                objects[urlsplit(self.path).path.split("/", 2)[2]] = body
                self.send_response(200)
                self.end_headers()

        def do_DELETE(self) -> None:
            if self._check(b""):
                objects.pop(urlsplit(self.path).path.split("/", 2)[2], None)
                self.send_response(204)
                self.end_headers()

        def do_GET(self) -> None:
            if not self._check(b""):
                return
            q = parse_qs(urlsplit(self.path).query)
            if "list-type" not in q:  # an object download
                body = objects.get(urlsplit(self.path).path.split("/", 2)[2])
                self.send_response(200 if body is not None else 404)
                self.send_header("Content-Length", str(len(body or b"")))
                self.end_headers()
                self.wfile.write(body or b"")
                return
            prefix = q.get("prefix", [""])[0]
            keys = "".join(
                f"<Contents><Key>{k}</Key></Contents>"
                for k in sorted(objects)
                if k.startswith(prefix)
            )
            data = f'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">{keys}</ListBucketResult>'.encode()
            self.send_response(200)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a: object) -> None:
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}", objects
    server.shutdown()


def test_s3_target_uploads_and_prunes(
    tmp_path: Path, fake_s3: tuple[str, dict[str, bytes]]
) -> None:
    endpoint, objects = fake_s3
    stale = (dt.datetime.now(dt.UTC) - dt.timedelta(days=31)).strftime(STAMP)
    objects[f"solosquad/sol/moa/hq/{stale}/office.db"] = b"old"
    target = SnapshotTarget(type="s3", endpoint=endpoint, region="ap-northeast-2", bucket="bk",
                            secret_ref="snap")  # fmt: skip
    result = ship(
        _backup(tmp_path),
        target,
        "sol/moa/hq",
        secret=lambda ref: f"{AK}:{SK}" if ref == "snap" else None,
    )
    assert result["files"] == 3 and result["location"].startswith("s3://bk/solosquad/sol/moa/hq/")
    assert result["pruned"] == [f"solosquad/sol/moa/hq/{stale}/office.db"]
    assert sorted(k.rsplit("/", 1)[1] for k in objects) == ["manifest.json", "office.db", "org.db"]
    with pytest.raises(ValueError, match="ACCESS_KEY:SECRET_KEY"):
        ship(tmp_path / "bk", target, "s", secret=lambda _r: "nocolon")


def test_an_office_snapshot_end_to_end(tmp_path: Path) -> None:
    sol = tmp_path / "moa"
    assert CliRunner().invoke(app, ["init", str(sol), "--org", "moa"]).exit_code == 0
    vault = tmp_path / "vault"
    res = CliRunner().invoke(
        app, ["snapshot", "set", "--type", "dir", "--path", str(vault), "-s", str(sol)]
    )
    assert res.exit_code == 0, res.output
    inst = build_instance(sol, "moa", "hq")
    org_dir = EngineStore(solosquad_home()).org_data_dir(Solution(sol).org("moa"))
    result = run_snapshot(inst, org_dir, now=time.time())
    names = sorted(p.name for p in Path(result["location"]).iterdir())
    assert "office.db" in names and "manifest.json" in names
    assert CliRunner().invoke(app, ["snapshot", "run", "-s", str(sol)]).exit_code == 0
    # without a target the job reports that it skipped instead of failing
    server = Solution(sol)
    server.update_server_config(snapshot=SnapshotTarget())
    assert run_snapshot(build_instance(sol, "moa", "hq"), org_dir)["target"] is None
    # the running instance follows core/server.yaml: a target set in the web after `serve`
    # started is used by the next daily run without a restart
    assert run_snapshot(inst, org_dir)["target"] is None
    later = tmp_path / "vault2"
    server.update_server_config(snapshot=SnapshotTarget(type="dir", path=str(later)))
    assert later in Path(run_snapshot(inst, org_dir)["location"]).parents


def test_restore_round_trip_and_refuses_a_corrupt_copy(tmp_path: Path) -> None:
    import json
    import sqlite3

    from solosquad.storage import OFFICE_DB

    sol = tmp_path / "moa"
    run = CliRunner().invoke
    assert run(app, ["init", str(sol), "--org", "moa"]).exit_code == 0
    vault = tmp_path / "vault"
    assert (
        run(
            app, ["snapshot", "set", "--type", "dir", "--path", str(vault), "-s", str(sol)]
        ).exit_code
        == 0
    )
    inst = build_instance(sol, "moa", "hq")
    kept = inst.manager.store.create_thread("before the snapshot")
    org_dir = EngineStore(solosquad_home()).org_data_dir(Solution(sol).org("moa"))
    stamp = Path(run_snapshot(inst, org_dir)["location"]).name
    inst.manager.store.create_thread("after the snapshot")  # work that the restore rolls back
    office = inst.ctx.data_dir / OFFICE_DB
    data_dir = inst.ctx.data_dir
    del inst  # the office is stopped: no open connections to the files being replaced
    import gc

    gc.collect()
    res = run(app, ["snapshot", "restore", "--yes", "-s", str(sol)])
    assert res.exit_code == 0, res.output
    titles = [r[0] for r in sqlite3.connect(office).execute("SELECT title FROM threads")]
    assert titles == ["before the snapshot"] and kept
    assert (office.parent / "office.db.before-restore").is_file()
    # a damaged copy is refused before anything is replaced
    snap = vault / "solosquad" / Solution(sol).meta().id / "moa/hq" / stamp
    (snap / "office.db").write_bytes(b"garbage")
    res = run(app, ["snapshot", "restore", "--yes", "--stamp", stamp, "-s", str(sol)])
    assert res.exit_code == 1 and "checksum" in res.output
    assert json.loads((snap / "manifest.json").read_text())["files"]
    # a running office is never restored underneath
    (data_dir / "server.json").write_text("{}")
    assert "stop the office" in run(app, ["snapshot", "restore", "--yes", "-s", str(sol)]).output


def test_fetch_from_s3(tmp_path: Path, fake_s3: tuple[str, dict[str, bytes]]) -> None:
    from solosquad.snapshots import fetch

    endpoint, _objects = fake_s3
    target = SnapshotTarget(type="s3", endpoint=endpoint, region="ap-northeast-2", bucket="bk",
                            secret_ref="snap")  # fmt: skip
    keys = lambda r: f"{AK}:{SK}"  # noqa: E731
    ship(_backup(tmp_path), target, "sol/moa/hq", secret=keys)
    got = fetch(target, "sol/moa/hq", None, tmp_path / "out", secret=keys)
    assert sorted(p.name for p in (tmp_path / "out").iterdir()) == [
        "manifest.json",
        "office.db",
        "org.db",
    ]
    assert len(got) == len("20261105T020000Z")
