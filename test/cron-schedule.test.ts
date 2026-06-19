import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSchedule, describeSchedule, nextRun } from "../src/scheduler/cron-schedule.js";
import { isSilentResult } from "../src/scheduler/crons.js";

test("normalizeSchedule passes through valid cron expressions", () => {
  assert.equal(normalizeSchedule("0 9 * * 1").cron, "0 9 * * 1");
  assert.equal(normalizeSchedule("*/15 * * * *").cron, "*/15 * * * *");
});

test("normalizeSchedule expands @shortcuts", () => {
  assert.equal(normalizeSchedule("@daily").cron, "0 0 * * *");
  assert.equal(normalizeSchedule("@hourly").cron, "0 * * * *");
  assert.equal(normalizeSchedule("@weekly").cron, "0 0 * * 0");
  assert.equal(normalizeSchedule("@MONTHLY").cron, "0 0 1 * *");
});

test("normalizeSchedule expands 'every <n><unit>' intervals", () => {
  assert.equal(normalizeSchedule("every 30m").cron, "*/30 * * * *");
  assert.equal(normalizeSchedule("every 2h").cron, "0 */2 * * *");
  assert.equal(normalizeSchedule("every 1d").cron, "0 0 */1 * *");
  assert.equal(normalizeSchedule("15m").cron, "*/15 * * * *"); // bare form
});

test("normalizeSchedule rejects out-of-range intervals and one-shots", () => {
  assert.ok(normalizeSchedule("every 90m").error);
  assert.ok(normalizeSchedule("every 30h").error);
  assert.ok(normalizeSchedule("2026-03-15T09:00:00").error); // one-shot ISO
  assert.ok(normalizeSchedule("garbage").error);
  assert.ok(normalizeSchedule("").error);
});

test("describeSchedule renders common shapes in plain language", () => {
  assert.equal(describeSchedule("0 9 * * *"), "daily at 09:00");
  assert.equal(describeSchedule("0 0 * * 0"), "weekly on Sun at 00:00");
  assert.equal(describeSchedule("*/10 * * * *"), "every 10 minute(s)");
  assert.equal(describeSchedule("0 */3 * * *"), "every 3 hour(s)");
  assert.equal(describeSchedule("0 0 1 * *"), "monthly on day 1 at 00:00");
});

test("nextRun returns a future Date for a valid expr, null for invalid", () => {
  const n = nextRun("0 0 * * *");
  assert.ok(n instanceof Date);
  assert.ok(n!.getTime() > Date.now());
  assert.equal(nextRun("not a cron"), null);
});

test("isSilentResult suppresses empty and [SILENT]-prefixed output", () => {
  assert.equal(isSilentResult(""), true);
  assert.equal(isSilentResult("   \n  "), true);
  assert.equal(isSilentResult("[SILENT]"), true);
  assert.equal(isSilentResult("[SILENT] nothing new today"), true);
  assert.equal(isSilentResult("[silent]"), true);
  assert.equal(isSilentResult("Here is your brief"), false);
  assert.equal(isSilentResult("contains [SILENT] mid-text"), false);
});
