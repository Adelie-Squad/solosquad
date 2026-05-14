import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * v0.6 S2 §2.4 — handoff 3-variant templates.
 *
 * Validates that the three pattern files exist under assets/templates/,
 * each carries the four base sections inherited from the legacy
 * `handoff.md`, and each variant adds the pattern-specific extra fields
 * called out in plan §2.4.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMPLATES_DIR = path.resolve(__dirname, "..", "assets", "templates");

const BASE_SECTIONS = [
  "## Summary",
  "## Artifacts",
  "## Key Decisions",
  "## Open Questions",
] as const;

function readTemplate(name: string): string {
  const fpath = path.join(TEMPLATES_DIR, name);
  assert.ok(fs.existsSync(fpath), `${name} should exist at ${fpath}`);
  return fs.readFileSync(fpath, "utf-8");
}

test("all 3 handoff variants exist and carry the 4 base sections", () => {
  for (const variant of [
    "handoff-hierarchical.md",
    "handoff-graph.md",
    "handoff-dynamic.md",
  ]) {
    const body = readTemplate(variant);
    for (const section of BASE_SECTIONS) {
      assert.ok(
        body.includes(section),
        `${variant} missing required base section "${section}"`
      );
    }
    // Each variant must declare its pattern in the Meta block.
    assert.match(
      body,
      /-\s*pattern:\s*(hierarchical|graph|dynamic)/,
      `${variant} missing "- pattern: <variant>" Meta line`
    );
  }
});

test("handoff-graph.md adds state_object_diff + loop_count", () => {
  const body = readTemplate("handoff-graph.md");
  assert.match(
    body,
    /loop_count/i,
    "graph handoff must reference loop_count"
  );
  assert.match(
    body,
    /state_object_diff/i,
    "graph handoff must reference state_object_diff"
  );
  // pattern declaration in Meta
  assert.match(body, /-\s*pattern:\s*graph/);
});

test("handoff-dynamic.md adds routing_signal", () => {
  const body = readTemplate("handoff-dynamic.md");
  assert.match(
    body,
    /routing_signal/i,
    "dynamic handoff must reference routing_signal"
  );
  assert.match(body, /-\s*pattern:\s*dynamic/);
});

test("handoff-hierarchical.md does NOT carry graph/dynamic extras", () => {
  const body = readTemplate("handoff-hierarchical.md");
  assert.equal(
    /state_object_diff|loop_count|routing_signal/i.test(body),
    false,
    "hierarchical handoff should stay minimal — extras belong to graph/dynamic"
  );
  assert.match(body, /-\s*pattern:\s*hierarchical/);
});

test("legacy handoff.md is preserved untouched for back-compat", () => {
  // Per S2 spec — historical handoff.md remains as the v0.3 template.
  const legacy = path.join(TEMPLATES_DIR, "handoff.md");
  assert.ok(
    fs.existsSync(legacy),
    "assets/templates/handoff.md must remain for v0.3 back-compat"
  );
  const body = fs.readFileSync(legacy, "utf-8");
  for (const section of BASE_SECTIONS) {
    assert.ok(body.includes(section), `legacy handoff.md lost "${section}"`);
  }
});
