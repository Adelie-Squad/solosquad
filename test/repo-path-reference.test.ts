import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveRepoCwd } from "../src/util/paths.js";

/**
 * v0.9.1 §13 — regression catcher for the model-B (path-reference) flow.
 *
 * Verifies that `resolveRepoCwd` correctly resolves to the external path
 * declared in `<workspace>/<org>/repositories/<slug>.yaml`, and falls back
 * to legacy behavior when the file is missing or malformed.
 *
 * Per `docs/plan/v0.9.1-workspace-repo-relationship.md` §7/§13 — path-reference
 * is the v0.9+ default, legacy tree stays permanently supported.
 */

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeYaml(file: string, doc: Record<string, unknown>): void {
  // Minimal YAML emitter for test fixtures — values are primitive strings.
  const lines: string[] = [];
  for (const [k, v] of Object.entries(doc)) {
    if (v === undefined) continue;
    lines.push(`${k}: ${typeof v === "string" ? JSON.stringify(v) : String(v)}`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf-8");
}

test("path-reference: resolveRepoCwd returns external path from repo yaml", () => {
  const workspace = makeTempDir("ss-ws-");
  const external = makeTempDir("ss-ext-");
  fs.mkdirSync(path.join(external, ".git"), { recursive: true });
  const orgDir = path.join(workspace, "personal");
  const reposDir = path.join(orgDir, "repositories");
  fs.mkdirSync(reposDir, { recursive: true });
  writeYaml(path.join(reposDir, "my-saas.yaml"), {
    slug: "my-saas",
    name: "my-saas",
    role: "main",
    linked_org: "personal",
    registered_at: new Date().toISOString(),
    path: external,
  });

  const resolved = resolveRepoCwd("personal", "my-saas", workspace);
  assert.equal(
    path.resolve(resolved),
    path.resolve(external),
    "resolveRepoCwd should return the external path",
  );
});

test("path-reference: missing external path falls through to legacy tree", () => {
  const workspace = makeTempDir("ss-ws-");
  const orgDir = path.join(workspace, "personal");
  const reposDir = path.join(orgDir, "repositories");
  // Legacy tree exists
  const legacyDir = path.join(reposDir, "my-saas");
  fs.mkdirSync(legacyDir, { recursive: true });
  // YAML points to a nonexistent path
  writeYaml(path.join(reposDir, "my-saas.yaml"), {
    slug: "my-saas",
    name: "my-saas",
    role: "main",
    linked_org: "personal",
    registered_at: new Date().toISOString(),
    path: "/nonexistent/path/to/repo",
  });

  const resolved = resolveRepoCwd("personal", "my-saas", workspace);
  assert.equal(
    path.resolve(resolved),
    path.resolve(legacyDir),
    "missing external path should fall through to legacy repositories/<slug>/ tree",
  );
});

test("path-reference: no yaml + legacy tree → legacy tree (backward-compat)", () => {
  const workspace = makeTempDir("ss-ws-");
  const orgDir = path.join(workspace, "personal");
  const reposDir = path.join(orgDir, "repositories");
  const legacyDir = path.join(reposDir, "my-saas");
  fs.mkdirSync(legacyDir, { recursive: true });

  const resolved = resolveRepoCwd("personal", "my-saas", workspace);
  assert.equal(
    path.resolve(resolved),
    path.resolve(legacyDir),
    "v0.8.x-and-earlier workspaces (legacy tree only, no yaml file) must keep working",
  );
});

test("RepoYaml interface declares optional path field (v0.9.1)", async () => {
  // Source inspection: util/config.ts must declare path?: string in RepoYaml.
  const __filename = new URL(import.meta.url).pathname;
  const __dirname = path.dirname(__filename.replace(/^\/([A-Z]:)/, "$1"));
  const configPath = path.resolve(__dirname, "..", "src", "util", "config.ts");
  const configTs = fs.readFileSync(configPath, "utf-8");
  assert.match(
    configTs,
    /interface RepoYaml\s*\{[\s\S]*?path\?\s*:\s*string/,
    "RepoYaml must declare optional `path?: string` field (v0.9.1 model B)",
  );
});
