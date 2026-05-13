import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  loadAgentsMd,
  DEFAULT_GUIDE,
  agentsMdPath,
} from "../src/engine/agents-md-loader.js";

function tempWs(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-agentsmd-"));
}

test("loadAgentsMd returns defaults when AGENTS.md does not exist", () => {
  const ws = tempWs();
  const guide = loadAgentsMd(ws);
  assert.equal(guide.exists, false);
  assert.deepEqual(guide.immutable_paths, DEFAULT_GUIDE.immutable_paths);
  assert.deepEqual(guide.modifiable_paths, DEFAULT_GUIDE.modifiable_paths);
  assert.equal(guide.stage_timeout_seconds, 600);
  assert.equal(guide.consecutive_discard_limit, 5);
  assert.equal(guide.cost_cap_warning_pct, 0.9);
});

test("loadAgentsMd merges declared immutable_paths with defaults", () => {
  const ws = tempWs();
  fs.writeFileSync(
    agentsMdPath(ws),
    `# AGENTS.md

## SoloSquad v0.4 — Autonomous Goal Conventions

### Immutable paths
- custom/extra/**
- vendored-lib/**

### Modifiable paths
- <org>/workflows/<wf-id>/
`,
    "utf-8"
  );
  const guide = loadAgentsMd(ws);
  assert.equal(guide.exists, true);
  // Should include defaults AND custom entries
  assert.ok(guide.immutable_paths.includes("src/engine/**"));
  assert.ok(guide.immutable_paths.includes("custom/extra/**"));
  assert.ok(guide.immutable_paths.includes("vendored-lib/**"));
  assert.deepEqual(guide.modifiable_paths, ["<org>/workflows/<wf-id>/"]);
});

test("loadAgentsMd extracts forbidden side-effects + whitelist", () => {
  const ws = tempWs();
  fs.writeFileSync(
    agentsMdPath(ws),
    `# AGENTS.md

## SoloSquad v0.4 — Autonomous Goal Conventions

### External side-effects
- messenger direct send
- payment
- external HTTP whitelist: api.example.com, *.cdn.com

### Guardrail thresholds
- stage_timeout_seconds: 900
- consecutive_discard_limit: 3
- cost_cap_warning: 80%
`,
    "utf-8"
  );
  const guide = loadAgentsMd(ws);
  assert.deepEqual(guide.forbidden_side_effects, ["messenger direct send", "payment"]);
  assert.deepEqual(guide.external_domain_whitelist, ["api.example.com", "*.cdn.com"]);
  assert.equal(guide.stage_timeout_seconds, 900);
  assert.equal(guide.consecutive_discard_limit, 3);
  assert.ok(Math.abs(guide.cost_cap_warning_pct - 0.8) < 1e-9);
});

test("loadAgentsMd tolerates AGENTS.md without the SoloSquad section", () => {
  const ws = tempWs();
  fs.writeFileSync(agentsMdPath(ws), "# AGENTS.md\n\n## Project\nAcme.\n", "utf-8");
  const guide = loadAgentsMd(ws);
  assert.equal(guide.exists, true);
  // Falls back to defaults
  assert.deepEqual(guide.immutable_paths, DEFAULT_GUIDE.immutable_paths);
});
