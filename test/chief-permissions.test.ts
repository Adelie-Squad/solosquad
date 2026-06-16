import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import {
  resolveChiefSpawnPermissions,
  DEV_OFF_DISALLOWED_TOOLS,
} from "../src/bot/chief-permissions.js";
import {
  setDevCapabilityEnabled,
  isDevCapabilityEnabled,
} from "../src/util/config.js";

function tempWs(devEnabled?: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-perm-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  const ws: Record<string, unknown> = {
    version: "1.2.9",
    display_name: "t",
    created_at: "2026-06-04T00:00:00Z",
  };
  if (devEnabled !== undefined) ws.dev_capability = { enabled: devEnabled };
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    yaml.dump(ws),
  );
  return dir;
}

test("dev ON → acceptEdits + write/git allow-list, push denied", () => {
  const ws = tempWs(true);
  const p = resolveChiefSpawnPermissions(ws);
  assert.equal(p.devEnabled, true);
  assert.equal(p.permissionMode, "acceptEdits");
  assert.ok(p.allowedTools?.includes("Write"));
  assert.ok(p.allowedTools?.includes("Edit"));
  assert.ok(p.allowedTools?.includes("Bash"));
  assert.ok(p.allowedTools?.includes("Task"));
  // v1.3.0 Part A — destructive commands stay denied...
  assert.ok(p.disallowedTools?.some((d) => d.includes("rm -rf")));
  // ...but push/PR are NOT statically denied when the approve-hook is wired:
  // the hook is the sole gate (a static deny would block even approved pushes).
  assert.ok(p.settingsPath, "dev ON should write the approve-hook settings file");
  assert.ok(
    !p.disallowedTools?.some((d) => d.includes("git push")),
    "git push must not be statically denied when the hook is the gate",
  );
  assert.ok(fs.existsSync(p.settingsPath!));
  const s = JSON.parse(fs.readFileSync(p.settingsPath!, "utf-8"));
  assert.ok(Array.isArray(s.hooks?.PreToolUse), "settings has PreToolUse hook");
  // The hook points at the v1.3.0 approve-flow script, not the deny-only one.
  const cmd = s.hooks.PreToolUse[0].hooks[0].command as string;
  assert.ok(cmd.includes("dev-confirm-hook"), "wired to approve-flow hook");
});

test("dev OFF → no permission mode, Bash/Edit/Write denied (no hang)", () => {
  const ws = tempWs(false);
  const p = resolveChiefSpawnPermissions(ws);
  assert.equal(p.devEnabled, false);
  assert.equal(p.permissionMode, undefined);
  assert.equal(p.allowedTools, undefined);
  assert.deepEqual(p.disallowedTools, [...DEV_OFF_DISALLOWED_TOOLS]);
  assert.equal(p.settingsPath, undefined); // no hook needed; Bash is denied
});

test("no dev_capability section → defaults ON (master toggle default true)", () => {
  const ws = tempWs(undefined);
  const p = resolveChiefSpawnPermissions(ws);
  assert.equal(p.devEnabled, true);
  assert.equal(p.permissionMode, "acceptEdits");
});

test("setDevCapabilityEnabled round-trips + returns the previous value", () => {
  const ws = tempWs(true);
  assert.equal(isDevCapabilityEnabled(ws), true);

  const prev = setDevCapabilityEnabled(false, ws);
  assert.equal(prev, true);
  assert.equal(isDevCapabilityEnabled(ws), false);
  // OFF now reflected in resolved permissions.
  assert.equal(resolveChiefSpawnPermissions(ws).devEnabled, false);

  const prev2 = setDevCapabilityEnabled(true, ws);
  assert.equal(prev2, false);
  assert.equal(isDevCapabilityEnabled(ws), true);
});
