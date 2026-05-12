import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import {
  listWorkflows,
  loadWorkflowSummary,
  resolveTargetRepoPath,
  latestHandoffPath,
} from "../src/bot/workspace-meta.js";
import { FileEventSink, workflowEventsPath } from "../src/bot/events.js";

function tempOrg(): { ws: string; org: string } {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-wsmeta-"));
  const org = "test-org";
  fs.mkdirSync(path.join(ws, org, "repositories"), { recursive: true });
  return { ws, org };
}

function makeWorkflow(
  ws: string,
  org: string,
  wfId: string,
  title: string,
  stages: Array<{ id: string; status: string; agent?: string; target_repo?: string | null; depends_on?: string[] }>,
  createdAt: string = "2026-05-12T10:00:00Z"
) {
  const dir = path.join(ws, org, "workflows", wfId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "_status.yaml"),
    yaml.dump({
      workflow_id: wfId,
      title,
      created_at: createdAt,
      stages,
    })
  );
}

test("listWorkflows returns empty when no workflows exist", () => {
  const { ws, org } = tempOrg();
  assert.deepEqual(listWorkflows(ws, org), []);
});

test("listWorkflows orders newest-first with stage rollups", () => {
  const { ws, org } = tempOrg();
  makeWorkflow(
    ws,
    org,
    "wf-2026-05-10-a",
    "first wf",
    [
      { id: "s1", status: "completed", agent: "x" },
      { id: "s2", status: "completed", agent: "y" },
    ],
    "2026-05-10T09:00:00Z"
  );
  makeWorkflow(
    ws,
    org,
    "wf-2026-05-12-b",
    "second wf",
    [
      { id: "s1", status: "completed", agent: "x" },
      { id: "s2", status: "in_progress", agent: "y" },
      { id: "s3", status: "pending", agent: "z" },
    ],
    "2026-05-12T09:00:00Z"
  );

  const list = listWorkflows(ws, org);
  assert.equal(list.length, 2);
  assert.equal(list[0].workflowId, "wf-2026-05-12-b");
  assert.equal(list[0].totalStages, 3);
  assert.equal(list[0].completedStages, 1);
  assert.equal(list[0].inProgressStages, 1);
  assert.equal(list[0].pendingStages, 1);
  assert.equal(list[1].workflowId, "wf-2026-05-10-a");
  assert.equal(list[1].completedStages, 2);
});

test("loadWorkflowSummary picks up events.jsonl tail timestamp", () => {
  const { ws, org } = tempOrg();
  makeWorkflow(ws, org, "wf-test", "t", [{ id: "s1", status: "pending" }]);
  const evPath = workflowEventsPath(ws, org, "wf-test");
  const sink = new FileEventSink(evPath);
  sink.append({
    ts: "2026-05-12T10:00:00Z",
    kind: "spawn.start",
    taskId: "t1",
    toolUseId: "u1",
    agent: "x",
    description: "d",
  });

  const sum = loadWorkflowSummary(ws, org, "wf-test");
  assert.ok(sum);
  assert.equal(sum!.recentEventCount, 1);
  assert.equal(sum!.lastEventTs, "2026-05-12T10:00:00Z");
});

test("resolveTargetRepoPath falls back to org root when repoSlug is null", () => {
  const { ws, org } = tempOrg();
  const p = resolveTargetRepoPath(ws, org, null);
  assert.equal(p, path.join(ws, org));
});

test("latestHandoffPath returns null when no stage dir has a _handoff.md", () => {
  const { ws, org } = tempOrg();
  makeWorkflow(ws, org, "wf-x", "x", [{ id: "s1", status: "pending" }]);
  assert.equal(latestHandoffPath(ws, org, "wf-x"), null);
});

test("latestHandoffPath returns the newest stage-N/_handoff.md by mtime", () => {
  const { ws, org } = tempOrg();
  makeWorkflow(ws, org, "wf-x", "x", [{ id: "s1", status: "completed" }]);
  const wfDir = path.join(ws, org, "workflows", "wf-x");
  fs.mkdirSync(path.join(wfDir, "stage-1-research"));
  fs.mkdirSync(path.join(wfDir, "stage-2-design"));
  fs.writeFileSync(path.join(wfDir, "stage-1-research", "_handoff.md"), "old");
  // Bump mtime ordering with a sleep
  const start = Date.now();
  while (Date.now() - start < 10) {
    /* spin */
  }
  fs.writeFileSync(path.join(wfDir, "stage-2-design", "_handoff.md"), "new");

  const got = latestHandoffPath(ws, org, "wf-x");
  assert.ok(got);
  assert.match(got!, /stage-2-design/);
});
