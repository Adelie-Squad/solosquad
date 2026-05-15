import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveUninstallMode } from "../src/cli/uninstall-mode.js";

/**
 * v0.8.4 §3 — `--mode` matrix for `solosquad uninstall`.
 *
 * Each scenario lines up one user invocation with one resolved mode. The
 * legacy aliases keep working in v0.8.4 but win over `--mode` so existing
 * scripts retain their behavior across the deprecation window.
 *
 * SOLOSQUAD_NO_DEPRECATION_WARN is set inside the suite so the captured
 * stderr from legacy paths doesn't pollute the test runner output — the
 * helper itself is covered by `cli-deprecation.test.ts`.
 */

test("default mode is full when nothing is passed", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    assert.equal(resolveUninstallMode({}), "full");
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});

test("--mode keep is honored", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    assert.equal(resolveUninstallMode({ mode: "keep" }), "keep");
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});

test("--mode archive-only is honored", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    assert.equal(resolveUninstallMode({ mode: "archive-only" }), "archive-only");
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});

test("legacy --archive-only resolves to archive-only", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    assert.equal(resolveUninstallMode({ archiveOnly: true }), "archive-only");
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});

test("legacy --keep-workspace resolves to keep", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    assert.equal(resolveUninstallMode({ keepWorkspace: true }), "keep");
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});

test("legacy --archive-only wins over --mode keep (compat priority)", () => {
  process.env.SOLOSQUAD_NO_DEPRECATION_WARN = "1";
  try {
    assert.equal(
      resolveUninstallMode({ archiveOnly: true, mode: "keep" }),
      "archive-only",
    );
  } finally {
    delete process.env.SOLOSQUAD_NO_DEPRECATION_WARN;
  }
});
