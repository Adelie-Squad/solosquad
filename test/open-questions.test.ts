import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createTask,
  loadTask,
  appendQuestions,
  markResolved,
  listTasks,
  pendingBlocking,
  type OpenQuestion,
} from "../src/util/open-questions.js";

function mkOrgRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ss-open-questions-"));
}

function q(id: string, blocking: boolean = true): OpenQuestion {
  return {
    id,
    stage: "test",
    type: "preference",
    question: `?${id}`,
    context: "test context",
    candidates: null,
    blocking,
  };
}

test("createTask: writes new file with pending status", () => {
  const orgRoot = mkOrgRoot();
  const task = createTask(
    { orgRoot },
    {
      task_id: "t1",
      from: "pm",
      to: "chief",
      questions: [q("q1"), q("q2", false)],
    }
  );
  assert.equal(task.status, "pending");
  assert.equal(task.resolved, null);
  const onDisk = loadTask({ orgRoot }, "t1");
  assert.ok(onDisk);
  assert.equal(onDisk.task_id, "t1");
  assert.equal(onDisk.questions.length, 2);
});

test("loadTask: returns null for missing task", () => {
  const orgRoot = mkOrgRoot();
  assert.equal(loadTask({ orgRoot }, "ghost"), null);
});

test("loadTask: returns null for malformed json", () => {
  const orgRoot = mkOrgRoot();
  const dir = path.join(orgRoot, "memory", "open-questions");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "broken.json"), "{not json}", "utf8");
  assert.equal(loadTask({ orgRoot }, "broken"), null);
});

test("appendQuestions: adds to existing task", () => {
  const orgRoot = mkOrgRoot();
  createTask(
    { orgRoot },
    { task_id: "t1", from: "pm", to: "chief", questions: [q("q1")] }
  );
  appendQuestions({ orgRoot }, "t1", [q("q2"), q("q3")]);
  const task = loadTask({ orgRoot }, "t1");
  assert.ok(task);
  assert.equal(task.questions.length, 3);
});

test("markResolved: blocking question resolution flips status to resolved", () => {
  const orgRoot = mkOrgRoot();
  createTask(
    { orgRoot },
    {
      task_id: "t1",
      from: "pm",
      to: "chief",
      questions: [q("q1"), q("q2")],
    }
  );
  markResolved({ orgRoot }, "t1", [
    { id: "q1", answer: "yes" },
    { id: "q2", answer: "no" },
  ]);
  const task = loadTask({ orgRoot }, "t1");
  assert.ok(task);
  assert.equal(task.status, "resolved");
  assert.equal(task.resolved?.length, 2);
});

test("markResolved: partial blocking → status partial", () => {
  const orgRoot = mkOrgRoot();
  createTask(
    { orgRoot },
    {
      task_id: "t1",
      from: "pm",
      to: "chief",
      questions: [q("q1"), q("q2")],
    }
  );
  markResolved({ orgRoot }, "t1", [{ id: "q1", answer: "yes" }]);
  const task = loadTask({ orgRoot }, "t1");
  assert.ok(task);
  assert.equal(task.status, "partial");
});

test("pendingBlocking: returns only unresolved blocking questions", () => {
  const orgRoot = mkOrgRoot();
  createTask(
    { orgRoot },
    {
      task_id: "t1",
      from: "pm",
      to: "chief",
      questions: [q("q1"), q("q2", false), q("q3")],
    }
  );
  markResolved({ orgRoot }, "t1", [{ id: "q1", answer: "x" }]);
  const task = loadTask({ orgRoot }, "t1");
  assert.ok(task);
  const blocking = pendingBlocking(task);
  assert.equal(blocking.length, 1);
  assert.equal(blocking[0]?.id, "q3");
});

test("listTasks: returns tasks sorted by filename", () => {
  const orgRoot = mkOrgRoot();
  createTask(
    { orgRoot },
    { task_id: "task-002", from: "pm", to: "chief", questions: [q("q")] }
  );
  createTask(
    { orgRoot },
    { task_id: "task-001", from: "pm", to: "chief", questions: [q("q")] }
  );
  const tasks = listTasks({ orgRoot });
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0]?.task_id, "task-001");
  assert.equal(tasks[1]?.task_id, "task-002");
});

test("listTasks: filters by status", () => {
  const orgRoot = mkOrgRoot();
  createTask(
    { orgRoot },
    { task_id: "pending-1", from: "pm", to: "chief", questions: [q("q1")] }
  );
  createTask(
    { orgRoot },
    { task_id: "resolved-1", from: "pm", to: "chief", questions: [q("q1")] }
  );
  markResolved({ orgRoot }, "resolved-1", [{ id: "q1", answer: "x" }]);
  const pending = listTasks({ orgRoot }, { status: "pending" });
  const resolved = listTasks({ orgRoot }, { status: "resolved" });
  assert.equal(pending.length, 1);
  assert.equal(pending[0]?.task_id, "pending-1");
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.task_id, "resolved-1");
});
