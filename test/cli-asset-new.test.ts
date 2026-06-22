import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

/**
 * v1.3.5 B-D4 — uniform `new` scaffold floor. `workflow new` and `skill new`
 * write deterministic, valid skeletons. (`agent new` is a commander alias of
 * the long-standing `agent add`, already covered by agent tests; goal/cron
 * `new` predate this version.)
 */

function withWorkspace<T>(fn: (ws: string) => Promise<T>): Promise<T> {
  return (async () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ss-new-"));
    fs.mkdirSync(path.join(ws, ".solosquad"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".solosquad", "workspace.yaml"), "version: 1.3.5\n");
    const prevCwd = process.cwd();
    const origLog = console.log;
    const prevExit = process.exitCode;
    console.log = () => {};
    process.chdir(ws);
    try {
      return await fn(ws);
    } finally {
      process.chdir(prevCwd);
      console.log = origLog;
      process.exitCode = prevExit;
    }
  })();
}

function seedOrg(ws: string, slug: string): void {
  fs.mkdirSync(path.join(ws, slug), { recursive: true });
  fs.writeFileSync(path.join(ws, slug, ".org.yaml"), `schema_version: 1\nname: ${slug}\nslug: ${slug}\n`);
}

test("workflow new: scaffolds a valid org-scoped workflow.yaml", async () => {
  await withWorkspace(async (ws) => {
    seedOrg(ws, "acme");
    const { workflowNewCommand } = await import("../src/cli/workflow.js");
    await workflowNewCommand("landing-refresh", {});
    const dest = path.join(ws, "acme", "workflows", "landing-refresh", "workflow.yaml");
    assert.ok(fs.existsSync(dest), "workflow.yaml should exist");
    const doc = yaml.load(fs.readFileSync(dest, "utf-8")) as Record<string, unknown>;
    assert.equal(doc.id, "landing-refresh");
    assert.ok(Array.isArray(doc.stages) && (doc.stages as unknown[]).length === 1);
    assert.equal(process.exitCode ?? 0, 0, "scaffold should validate clean");
  });
});

test("workflow new: rejects a non-kebab id", async () => {
  await withWorkspace(async (ws) => {
    seedOrg(ws, "acme");
    const { workflowNewCommand } = await import("../src/cli/workflow.js");
    await workflowNewCommand("Not Kebab", {});
    assert.equal(process.exitCode, 2);
    process.exitCode = 0;
  });
});

test("workflow new: refuses to clobber an existing workflow", async () => {
  await withWorkspace(async (ws) => {
    seedOrg(ws, "acme");
    const dest = path.join(ws, "acme", "workflows", "dup", "workflow.yaml");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, "id: dup\ncustom: keep\n");
    const { workflowNewCommand } = await import("../src/cli/workflow.js");
    await workflowNewCommand("dup", {});
    assert.match(fs.readFileSync(dest, "utf-8"), /keep/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });
});

test("skill new: scaffolds a valid SKILL.md under .solosquad/skills/", async () => {
  await withWorkspace(async (ws) => {
    const { skillNewCommand } = await import("../src/cli/skill.js");
    await skillNewCommand("my-skill", {});
    const dest = path.join(ws, ".solosquad", "skills", "my-skill", "SKILL.md");
    assert.ok(fs.existsSync(dest), "SKILL.md should exist");
    const { parseSkillMd, validateSkill } = await import("../src/bot/skill-parser.js");
    const spec = parseSkillMd(fs.readFileSync(dest, "utf-8"), dest);
    assert.equal(spec.name, "my-skill");
    assert.equal(validateSkill(spec).ok, true, "scaffolded skill must validate");
  });
});

test("skill new: rejects a non-kebab name", async () => {
  await withWorkspace(async () => {
    const { skillNewCommand } = await import("../src/cli/skill.js");
    await skillNewCommand("Bad Name", {});
    assert.equal(process.exitCode, 2);
    process.exitCode = 0;
  });
});
