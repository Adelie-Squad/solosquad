import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { logger, rotateLogs, currentLogFile, _loggerInternals } from "../src/util/logger.js";

/**
 * v0.8.3 §5.1 — logger extension tests.
 *
 * Each scenario captures stdout/stderr to verify level + format behavior,
 * then writes to a temp log dir via SOLOSQUAD_LOG_DIR to test the file
 * sink + rotation.
 */

interface Captured {
  stdout: string[];
  stderr: string[];
  restore: () => void;
}

function captureConsole(): Captured {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => stdout.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => stderr.push(args.map(String).join(" "));
  return {
    stdout,
    stderr,
    restore() {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k]!;
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  }
}

test("logger emits info by default and suppresses debug", () => {
  withEnv({ SOLOSQUAD_LOG_LEVEL: undefined, SOLOSQUAD_LOG_FORMAT: undefined, SOLOSQUAD_LOG_FILE: undefined }, () => {
    const cap = captureConsole();
    try {
      logger.info("test", "hello");
      logger.debug("not shown");
      assert.ok(cap.stdout.some((l) => l.includes("hello")));
      assert.ok(!cap.stdout.some((l) => l.includes("not shown")));
    } finally {
      cap.restore();
    }
  });
});

test("logger.debug emits when SOLOSQUAD_LOG_LEVEL=debug", () => {
  withEnv({ SOLOSQUAD_LOG_LEVEL: "debug" }, () => {
    const cap = captureConsole();
    try {
      logger.debug("verbose info");
      assert.ok(cap.stdout.some((l) => l.includes("verbose info")));
    } finally {
      cap.restore();
    }
  });
});

test("logger.error never suppressed even at LEVEL=error", () => {
  withEnv({ SOLOSQUAD_LOG_LEVEL: "error" }, () => {
    const cap = captureConsole();
    try {
      logger.error("boom");
      logger.info("test", "muted");
      assert.ok(cap.stderr.some((l) => l.includes("boom")));
      assert.ok(!cap.stdout.some((l) => l.includes("muted")));
    } finally {
      cap.restore();
    }
  });
});

test("logger emits JSON when SOLOSQUAD_LOG_FORMAT=json", () => {
  withEnv({ SOLOSQUAD_LOG_FORMAT: "json", SOLOSQUAD_LOG_LEVEL: "info" }, () => {
    const cap = captureConsole();
    try {
      logger.info("tag", "structured");
      const json = cap.stdout.find((l) => l.includes("structured"));
      assert.ok(json, "expected json line");
      const parsed = JSON.parse(json!.trim()) as Record<string, unknown>;
      assert.equal(parsed.level, "info");
      assert.equal(parsed.tag, "tag");
      assert.equal(parsed.message, "structured");
      assert.ok(typeof parsed.ts === "string");
    } finally {
      cap.restore();
    }
  });
});

test("logger writes file when SOLOSQUAD_LOG_FILE=1 + SOLOSQUAD_LOG_DIR is set", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-logger-file-"));
  try {
    withEnv({ SOLOSQUAD_LOG_FILE: "1", SOLOSQUAD_LOG_DIR: dir, SOLOSQUAD_LOG_LEVEL: "info" }, () => {
      const cap = captureConsole();
      try {
        logger.info("svc", "file-out");
      } finally {
        cap.restore();
      }
      const file = currentLogFile()!;
      assert.ok(fs.existsSync(file));
      const body = fs.readFileSync(file, "utf-8");
      const line = body.trim().split("\n").pop()!;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      assert.equal(parsed.message, "file-out");
      assert.equal(parsed.tag, "svc");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rotateLogs deletes files older than retention but keeps recent ones", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-logger-rotate-"));
  try {
    const old = path.join(dir, "solosquad-2020-01-01.log");
    const recent = path.join(dir, `solosquad-${new Date().toISOString().slice(0, 10)}.log`);
    const unrelated = path.join(dir, "notes.txt");
    fs.writeFileSync(old, "old\n");
    fs.writeFileSync(recent, "recent\n");
    fs.writeFileSync(unrelated, "noise\n");

    const removed = rotateLogs({ retentionDays: 14, logDir: dir });
    assert.ok(removed.some((p) => p.endsWith("solosquad-2020-01-01.log")));
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(recent), true);
    assert.equal(fs.existsSync(unrelated), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("logger uses date-rolled filename per day", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-logger-roll-"));
  try {
    withEnv({ SOLOSQUAD_LOG_DIR: dir }, () => {
      const file = currentLogFile(new Date("2026-05-15T10:00:00Z"))!;
      assert.ok(file.endsWith(`solosquad-2026-05-15.log`));
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("logger internals expose current resolved level + format + file-output state", () => {
  withEnv({ SOLOSQUAD_LOG_LEVEL: "warn", SOLOSQUAD_LOG_FORMAT: "json", SOLOSQUAD_LOG_FILE: "1" }, () => {
    assert.equal(_loggerInternals.activeLevel(), "warn");
    assert.equal(_loggerInternals.activeFormat(), "json");
    assert.equal(_loggerInternals.fileOutputEnabled(), true);
  });
});
