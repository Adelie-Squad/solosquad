import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSchedule, describeSchedule, nextRun, nextRuns, estimatePeriodMinutes, isOverdue, parseWhen, parseDelaySeconds } from "../src/scheduler/cron-schedule.js";
import { isSilentResult } from "../src/scheduler/crons.js";

// v1.3.4 §A — jitter/delay parsing.
test("parseDelaySeconds handles s/m/h and rejects junk", () => {
  assert.equal(parseDelaySeconds("90s"), 90);
  assert.equal(parseDelaySeconds("5m"), 300);
  assert.equal(parseDelaySeconds("2h"), 7200);
  assert.equal(parseDelaySeconds(""), null);
  assert.equal(parseDelaySeconds("soon"), null);
  assert.equal(parseDelaySeconds(undefined), null);
});

// v1.3.4 §B — next-N preview.
test("nextRuns returns N ascending future times for a daily cron", () => {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0); // 2026-01-01T00:00Z
  const runs = nextRuns("0 9 * * *", 3, "UTC", base);
  assert.equal(runs.length, 3);
  for (let i = 1; i < runs.length; i++) {
    assert.ok(runs[i].getTime() > runs[i - 1].getTime());
  }
  assert.equal(runs[0].getTime(), Date.UTC(2026, 0, 1, 9, 0, 0));
});

test("nextRuns honors day-of-week and returns [] for invalid", () => {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0); // Thu
  const mondays = nextRuns("0 0 * * 1", 2, "UTC", base);
  assert.equal(mondays.length, 2);
  assert.ok(mondays.every((d) => d.getUTCDay() === 1));
  assert.equal(nextRuns("not a cron", 3, "UTC", base).length, 0);
});

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

test("estimatePeriodMinutes recognises common cadences", () => {
  assert.equal(estimatePeriodMinutes("*/30 * * * *"), 30);
  assert.equal(estimatePeriodMinutes("0 */2 * * *"), 120);
  assert.equal(estimatePeriodMinutes("0 9 * * *"), 1440); // daily
  assert.equal(estimatePeriodMinutes("0 9 * * 1"), 10080); // weekly
  assert.equal(estimatePeriodMinutes("0 0 1 * *"), 43200); // monthly
  assert.equal(estimatePeriodMinutes("0 9,17 * * *"), null); // unrecognised shape
});

test("isOverdue flags a stale daily cron, not a fresh one", () => {
  const now = Date.parse("2026-06-10T12:00:00.000Z");
  const daily = "0 9 * * *";
  assert.equal(isOverdue(null, daily, now), false, "never-run = not overdue");
  assert.equal(isOverdue("2026-06-10T09:00:00.000Z", daily, now), false, "ran 3h ago");
  assert.equal(isOverdue("2026-06-07T09:00:00.000Z", daily, now), true, "3 days stale > 2× daily");
  assert.equal(isOverdue("2026-01-01T00:00:00.000Z", "0 9,17 * * *", now), false, "unknown cadence = can't judge");
});

test("parseWhen handles relative delays and ISO, rejects past/garbage", () => {
  const now = Date.parse("2026-06-10T12:00:00.000Z");
  assert.equal(parseWhen("20m", now).at, "2026-06-10T12:20:00.000Z");
  assert.equal(parseWhen("2h", now).at, "2026-06-10T14:00:00.000Z");
  assert.equal(parseWhen("2026-06-11T09:00:00.000Z", now).at, "2026-06-11T09:00:00.000Z");
  assert.ok(parseWhen("2020-01-01T00:00:00Z", now).error, "past rejected");
  assert.ok(parseWhen("whenever", now).error);
  assert.ok(parseWhen("", now).error);
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
