import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFocusMarker, stripFocusMarkers } from "../src/bot/focus-markers.js";

test("parseFocusMarker returns null for empty / no-marker text", () => {
  assert.equal(parseFocusMarker(""), null);
  assert.equal(parseFocusMarker("just a regular reply"), null);
});

test("parseFocusMarker extracts a single workflow id", () => {
  const r = parseFocusMarker("OK, switching context. [focus:wf-2026-05-12-launch]");
  assert.deepEqual(r, { workflowId: "wf-2026-05-12-launch" });
});

test("parseFocusMarker recognizes [focus:none] as clear", () => {
  const r = parseFocusMarker("Wrapping up. [focus:none]");
  assert.deepEqual(r, { workflowId: null });
});

test("parseFocusMarker returns the LAST marker when multiple exist", () => {
  const text = `First [focus:wf-A] then thinking... finally [focus:wf-B].`;
  assert.deepEqual(parseFocusMarker(text), { workflowId: "wf-B" });
});

test("stripFocusMarkers removes the marker and tidies whitespace", () => {
  const text = "Here is my plan. [focus:wf-A]\n\nNext: …";
  const stripped = stripFocusMarkers(text);
  assert.equal(stripped.includes("[focus:"), false);
  assert.equal(stripped.includes("wf-A"), false);
  assert.match(stripped, /Here is my plan\./);
});

test("stripFocusMarkers leaves text unchanged when no markers present", () => {
  const text = "Regular text without markers.";
  assert.equal(stripFocusMarkers(text), text);
});
