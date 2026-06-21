import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isValidIanaTimezone,
  suggestTimezone,
  allTimezones,
  TIMEZONE_PRESETS,
  TIMEZONE_OTHER,
} from "../src/util/timezone.js";

test("isValidIanaTimezone accepts real zones, rejects typos", () => {
  assert.ok(isValidIanaTimezone("Asia/Seoul"));
  assert.ok(isValidIanaTimezone("UTC"));
  assert.ok(!isValidIanaTimezone("Asia/Seuol"));
  assert.ok(!isValidIanaTimezone(""));
  assert.ok(!isValidIanaTimezone("Mars/Phobos"));
});

test("allTimezones returns the IANA set", () => {
  const zones = allTimezones();
  assert.ok(zones.length > 100);
  assert.ok(zones.includes("Asia/Seoul"));
});

test("suggestTimezone fixes a near-miss typo", () => {
  assert.equal(suggestTimezone("Asia/Seuol"), "Asia/Seoul");
});

test("suggestTimezone matches by city segment", () => {
  assert.equal(suggestTimezone("seoul"), "Asia/Seoul");
});

test("suggestTimezone normalizes spaces/case", () => {
  assert.equal(suggestTimezone("asia/seoul"), "Asia/Seoul");
});

test("suggestTimezone returns null for nonsense / empty", () => {
  assert.equal(suggestTimezone(""), null);
  assert.equal(suggestTimezone("zzzzzzzzzzzzzz"), null);
});

test("presets include an Other sentinel", () => {
  assert.ok(TIMEZONE_PRESETS.some((p) => p.value === TIMEZONE_OTHER));
  assert.ok(TIMEZONE_PRESETS.some((p) => p.value === "Asia/Seoul"));
});
