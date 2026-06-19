import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import { scaffoldOrg } from "../src/util/scaffold.js";

function tempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-scaffold-v12-"));
}

test("scaffoldOrg — creates the full v1.1 + v1.2 directory layout", () => {
  const ws = tempWorkspace();
  scaffoldOrg({
    workspace: ws,
    name: "Acme Inc",
    provider: "github",
    remoteUrl: null,
    messenger: "discord",
  });
  const orgDir = path.join(ws, "acme-inc");
  for (const sub of [
    "memory/cron-logs",
    "memory/open-questions",
    "memory/ledger",
    "workflows",
    "repositories",
    "knowledge",
    "discord",
  ]) {
    assert.ok(
      fs.existsSync(path.join(orgDir, sub)),
      `missing ${sub}`,
    );
  }
});

test("scaffoldOrg — writes the 4 schema JSONLs in memory/", () => {
  const ws = tempWorkspace();
  scaffoldOrg({
    workspace: ws,
    name: "Acme",
    provider: "local",
    remoteUrl: null,
    messenger: "discord",
  });
  const memDir = path.join(ws, "acme", "memory");
  for (const f of [
    "hypotheses.jsonl",
    "experiments.jsonl",
    "decisions.jsonl",
    "signals.jsonl",
  ]) {
    assert.ok(fs.existsSync(path.join(memDir, f)), `missing ${f}`);
  }
});

test("scaffoldOrg — writes chief_name into .org.yaml when provided (v1.2 §4.1)", () => {
  const ws = tempWorkspace();
  scaffoldOrg({
    workspace: ws,
    name: "Acme",
    provider: "local",
    remoteUrl: null,
    messenger: "discord",
    chiefName: "Hermes",
  });
  const orgYaml = yaml.load(
    fs.readFileSync(path.join(ws, "acme", ".org.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  assert.equal(orgYaml.chief_name, "Hermes");
});

test("scaffoldOrg — omits chief_name from .org.yaml when not provided", () => {
  const ws = tempWorkspace();
  scaffoldOrg({
    workspace: ws,
    name: "Acme",
    provider: "local",
    remoteUrl: null,
    messenger: "discord",
  });
  const orgYaml = yaml.load(
    fs.readFileSync(path.join(ws, "acme", ".org.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  assert.ok(
    !("chief_name" in orgYaml),
    "chief_name should not be written when undefined (runtime fallback is 'Chief')",
  );
});

test("scaffoldOrg — seeds problem-definition workflow from the bundle (v1.2 §12 #16)", () => {
  const ws = tempWorkspace();
  scaffoldOrg({
    workspace: ws,
    name: "Acme",
    provider: "local",
    remoteUrl: null,
    messenger: "discord",
  });
  const seeded = path.join(
    ws,
    "acme",
    "workflows",
    "problem-definition",
    "workflow.yaml",
  );
  assert.ok(fs.existsSync(seeded), "problem-definition workflow not seeded");
  // Sanity-check the seeded yaml is the bundle artifact (loaded correctly).
  const wf = yaml.load(fs.readFileSync(seeded, "utf-8")) as Record<string, unknown>;
  assert.equal(wf.id, "problem-definition");
  assert.ok(Array.isArray(wf.stages));
});

test("scaffoldOrg — copies chief SKILL.md + 4 team folders from the bundle", () => {
  const ws = tempWorkspace();
  scaffoldOrg({
    workspace: ws,
    name: "Acme",
    provider: "local",
    remoteUrl: null,
    messenger: "discord",
  });
  const orgDir = path.join(ws, "acme");
  assert.ok(
    fs.existsSync(path.join(orgDir, "agents", "main", "chief", "SKILL.md")),
    "chief SKILL.md not copied",
  );
  for (const team of ["product", "engineering", "design", "marketing"]) {
    assert.ok(
      fs.existsSync(path.join(orgDir, "teams", team, "OKR.md")),
      `${team}/OKR.md not copied`,
    );
    assert.ok(
      fs.existsSync(path.join(orgDir, "teams", team, "composition.yaml")),
      `${team}/composition.yaml not copied`,
    );
  }
});

test("scaffoldOrg — re-scaffolding the same org never clobbers customized files", () => {
  const ws = tempWorkspace();
  scaffoldOrg({
    workspace: ws,
    name: "Acme",
    provider: "local",
    remoteUrl: null,
    messenger: "discord",
  });
  const chiefSkill = path.join(
    ws,
    "acme",
    "agents",
    "main",
    "chief",
    "SKILL.md",
  );
  fs.writeFileSync(chiefSkill, "# my customized chief\n");
  // Second call — directories already exist, so caller would normally
  // refuse via add-org's existsSync guard. scaffoldOrg itself is the
  // idempotent primitive that backs both add-org and migrations.
  scaffoldOrg({
    workspace: ws,
    name: "Acme",
    provider: "local",
    remoteUrl: null,
    messenger: "discord",
  });
  assert.equal(
    fs.readFileSync(chiefSkill, "utf-8"),
    "# my customized chief\n",
    "customized chief SKILL.md was overwritten",
  );
});
