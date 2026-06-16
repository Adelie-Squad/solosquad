import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DevConfirmBridge } from "../src/bot/dev-confirm-bridge.js";
import {
  pendingConfirmsDir,
  decisionPath,
  type PendingConfirmFile,
} from "../src/bot/dev-confirm-paths.js";
import { devConfirmAuditPath } from "../src/bot/dev-confirm.js";

const ORG = "acme";

function tmpWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ss-bridge-"));
}

function writePending(ws: string, req: PendingConfirmFile): string {
  const dir = pendingConfirmsDir(ws, ORG);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${req.id}.json`);
  fs.writeFileSync(file, JSON.stringify(req), "utf-8");
  return dir;
}

function sampleReq(id: string): PendingConfirmFile {
  return {
    id,
    orgSlug: ORG,
    handle: "owner",
    user: "u1",
    cmd: "git push origin feat/x",
    branch: "feat/x",
    repoSlug: "app",
    commits: ["abc123 fix bug"],
    workflowId: "wf-1",
    ts: "2026-06-16T00:00:00Z",
  };
}

test("bridge — approved → writes decision 'y' + enriched audit", async () => {
  const ws = tmpWs();
  const dir = writePending(ws, sampleReq("id-y"));

  let posted: PendingConfirmFile | null = null;
  const bridge = new DevConfirmBridge({
    workspace: ws,
    orgSlug: ORG,
    postApproval: async (req) => {
      posted = req;
      return "y";
    },
  });
  await bridge.scanOnce();
  bridge.stop();

  assert.ok(posted, "poster was called");
  assert.equal(fs.readFileSync(decisionPath(dir, "id-y"), "utf-8").trim(), "y");

  const audit = fs.readFileSync(devConfirmAuditPath(ws, ORG), "utf-8").trim();
  const rec = JSON.parse(audit);
  assert.equal(rec.decision, "y");
  assert.equal(rec.branch, "feat/x");
  assert.equal(rec.workflow_id, "wf-1");
  assert.deepEqual(rec.commits, ["abc123 fix bug"]);
});

test("bridge — rejected → writes decision 'n'", async () => {
  const ws = tmpWs();
  const dir = writePending(ws, sampleReq("id-n"));

  const bridge = new DevConfirmBridge({
    workspace: ws,
    orgSlug: ORG,
    postApproval: async () => "n",
  });
  await bridge.scanOnce();
  bridge.stop();

  assert.equal(fs.readFileSync(decisionPath(dir, "id-n"), "utf-8").trim(), "n");
});

test("bridge — skips requests that already have a decision (restart idempotency)", async () => {
  const ws = tmpWs();
  const dir = writePending(ws, sampleReq("id-done"));
  fs.writeFileSync(decisionPath(dir, "id-done"), "y", "utf-8");

  let called = false;
  const bridge = new DevConfirmBridge({
    workspace: ws,
    orgSlug: ORG,
    postApproval: async () => {
      called = true;
      return "n";
    },
  });
  await bridge.scanOnce();
  bridge.stop();

  assert.equal(called, false, "already-resolved request must not re-post");
  // decision file unchanged
  assert.equal(fs.readFileSync(decisionPath(dir, "id-done"), "utf-8").trim(), "y");
});

test("bridge — poster error resolves to 'n' (block)", async () => {
  const ws = tmpWs();
  const dir = writePending(ws, sampleReq("id-err"));

  const bridge = new DevConfirmBridge({
    workspace: ws,
    orgSlug: ORG,
    postApproval: async () => {
      throw new Error("discord down");
    },
  });
  await bridge.scanOnce();
  bridge.stop();

  assert.equal(fs.readFileSync(decisionPath(dir, "id-err"), "utf-8").trim(), "n");
});
