import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import { migration } from "../src/migrations/scripts/1.1.0-to-1.2.0.js";

function tempWorkspace(version: string, productSlugs: string[] = ["acme"]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-v12-mig-"));
  const cfgDir = path.join(dir, ".solosquad");
  fs.mkdirSync(path.join(cfgDir, "core"), { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, "workspace.yaml"),
    yaml.dump({
      version,
      display_name: "test",
      created_at: new Date().toISOString(),
    }),
  );
  fs.writeFileSync(
    path.join(cfgDir, "core", "products.json"),
    JSON.stringify(productSlugs.map((slug) => ({ name: slug, slug }))),
  );
  for (const slug of productSlugs) {
    fs.mkdirSync(path.join(dir, slug, "workflows"), { recursive: true });
  }
  return dir;
}

test("1.1.0→1.2.0 — detect() fires on 1.1.0", async () => {
  const ws = tempWorkspace("1.1.0");
  assert.equal(await migration.detect(ws), true);
});

test("1.1.0→1.2.0 — detect() fires on 1.1.0.<extra> (4-segment legacy)", async () => {
  const ws = tempWorkspace("1.1.0.1");
  assert.equal(await migration.detect(ws), true);
});

test("1.1.0→1.2.0 — detect() does NOT fire on 1.0.x", async () => {
  const ws = tempWorkspace("1.0.4");
  assert.equal(await migration.detect(ws), false);
});

test("1.1.0→1.2.0 — detect() does NOT fire on 1.2.0 (idempotent)", async () => {
  const ws = tempWorkspace("1.2.0");
  assert.equal(await migration.detect(ws), false);
});

test("1.1.0→1.2.0 — plan() includes version bump", async () => {
  const ws = tempWorkspace("1.1.0");
  const plan = await migration.plan(ws);
  const bump = plan.steps.find(
    (s) => s.kind === "update" && (s.to ?? "").includes("workspace.yaml.version=1.2.0"),
  );
  assert.ok(bump, "version-bump step missing");
});

test("1.1.0→1.2.0 — plan() includes discord workspace policy seed when missing", async () => {
  const ws = tempWorkspace("1.1.0");
  const plan = await migration.plan(ws);
  const seed = plan.steps.find(
    (s) =>
      s.kind === "update" &&
      (s.to ?? "").includes("workspace.yaml.messenger.discord="),
  );
  assert.ok(seed, "discord policy seed step missing from plan");
  assert.match(seed!.to ?? "", /owner_only:false/);
});

test("1.1.0→1.2.0 — plan() warns about Chief name + owner_only=false (upgrade-safe)", async () => {
  const ws = tempWorkspace("1.1.0");
  const plan = await migration.plan(ws);
  assert.ok(
    plan.warnings.some((w) => w.includes("Chief name")),
    "Chief name warning missing",
  );
  assert.ok(
    plan.warnings.some((w) => w.includes("owner-only")),
    "owner-only warning missing",
  );
});

test("1.1.0→1.2.0 — apply() bumps version + seeds messenger.discord", async () => {
  const ws = tempWorkspace("1.1.0");
  await migration.apply(ws);
  const after = yaml.load(
    fs.readFileSync(path.join(ws, ".solosquad", "workspace.yaml"), "utf-8"),
  ) as Record<string, unknown>;
  assert.equal(after.version, "1.2.0");
  assert.equal(after.last_migrated_to, "1.2.0");
  const msg = (after.messenger as Record<string, unknown> | undefined)?.discord as
    | Record<string, unknown>
    | undefined;
  assert.ok(msg, "messenger.discord block not seeded");
  assert.equal(msg!.owner_only, false);
  assert.equal(msg!.install_mode, "byo_manual");
  assert.equal(msg!.thread_token_budget, 80_000);
});

test("1.1.0→1.2.0 — apply() preserves an existing messenger.discord block (idempotent)", async () => {
  const ws = tempWorkspace("1.1.0");
  const file = path.join(ws, ".solosquad", "workspace.yaml");
  const original = yaml.load(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  original.messenger = { discord: { owner_only: true, install_mode: "oauth_invite" } };
  fs.writeFileSync(file, yaml.dump(original));

  await migration.apply(ws);
  const after = yaml.load(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
  const msg = (after.messenger as Record<string, unknown>).discord as Record<string, unknown>;
  assert.equal(msg.owner_only, true, "user's explicit owner_only=true must survive");
  assert.equal(msg.install_mode, "oauth_invite");
});

test("1.1.0→1.2.0 — apply() never clobbers a pre-existing workflows/problem-definition/workflow.yaml", async () => {
  const ws = tempWorkspace("1.1.0", ["acme"]);
  const seededDir = path.join(ws, "acme", "workflows", "problem-definition");
  fs.mkdirSync(seededDir, { recursive: true });
  fs.writeFileSync(path.join(seededDir, "workflow.yaml"), "custom: by-user\n");

  await migration.apply(ws);
  assert.equal(
    fs.readFileSync(path.join(seededDir, "workflow.yaml"), "utf-8"),
    "custom: by-user\n",
  );
});

test("1.1.0→1.2.0 — verify() succeeds after apply", async () => {
  const ws = tempWorkspace("1.1.0");
  await migration.apply(ws);
  const v = await migration.verify(ws);
  assert.equal(v.ok, true);
});

test("1.1.0→1.2.0 — verify() reports version mismatch when apply did not run", async () => {
  const ws = tempWorkspace("1.1.0");
  const v = await migration.verify(ws);
  assert.equal(v.ok, false);
  assert.match(v.error ?? "", /version is 1\.1\.0/);
});
