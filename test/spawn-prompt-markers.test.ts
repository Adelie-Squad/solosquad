import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpawnMarkers } from "../src/bot/spawn-prompt-markers.js";

test("parseSpawnMarkers returns empty object for empty/null-ish input", () => {
  assert.deepEqual(parseSpawnMarkers(""), {});
  assert.deepEqual(parseSpawnMarkers("plain prompt with no markers"), {});
});

test("parseSpawnMarkers extracts combined [stage:X wf:Y] marker", () => {
  const prompt = `[stage:stage-1-research wf:wf-2026-05-12-landing]
Target repo: /abs/path/repos/web
Read the PRD at workflows/wf-2026-05-12-landing/PRD.md and brainstorm.`;
  assert.deepEqual(parseSpawnMarkers(prompt), {
    stageId: "stage-1-research",
    workflowId: "wf-2026-05-12-landing",
  });
});

test("parseSpawnMarkers extracts stage-only marker", () => {
  const prompt = `[stage:stage-2-design]
do this thing`;
  assert.deepEqual(parseSpawnMarkers(prompt), {
    stageId: "stage-2-design",
    workflowId: undefined,
  });
});

test("parseSpawnMarkers extracts wf-only marker", () => {
  const prompt = `[wf:wf-2026-05-12-experiment]
need help with X`;
  assert.deepEqual(parseSpawnMarkers(prompt), {
    workflowId: "wf-2026-05-12-experiment",
  });
});

test("parseSpawnMarkers tolerates leading whitespace", () => {
  const prompt = `   [stage:s-1]
body`;
  assert.deepEqual(parseSpawnMarkers(prompt), {
    stageId: "s-1",
    workflowId: undefined,
  });
});

test("parseSpawnMarkers ignores marker-shaped substrings on non-marker lines", () => {
  const prompt = `Some explanation [stage:fake] inline.
[stage:real-1 wf:wf-x]
body`;
  // MARKER_LINE is anchored to start-of-line via /^...$/m, so the inline
  // mention is skipped and the real marker is picked up.
  assert.deepEqual(parseSpawnMarkers(prompt), {
    stageId: "real-1",
    workflowId: "wf-x",
  });
});

test("parseSpawnMarkers returns empty when content looks similar but wrong", () => {
  assert.deepEqual(parseSpawnMarkers("[stage]"), {});
  assert.deepEqual(parseSpawnMarkers("[stage : with-spaces]"), {});
});
