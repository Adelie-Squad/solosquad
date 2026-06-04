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
  assert.ok(p.disallowedTools?.some((d) => d.includes("git push")));
  assert.ok(p.disallowedTools?.some((d) => d.includes("gh pr merge")));
});

test("dev OFF → no permission mode, Bash/Edit/Write denied (no hang)", () => {
  const ws = tempWs(false);
  const p = resolveChiefSpawnPermissions(ws);
  assert.equal(p.devEnabled, false);
  assert.equal(p.permissionMode, undefined);
  assert.equal(p.allowedTools, undefined);
  assert.deepEqual(p.disallowedTools, [...DEV_OFF_DISALLOWED_TOOLS]);
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
