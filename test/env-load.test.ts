import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const BIN = path.join(REPO_ROOT, "bin", "solosquad.ts");

function makeWorkspace(envContent: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-test-"));
  fs.writeFileSync(path.join(dir, ".env"), envContent, "utf-8");
  fs.mkdirSync(path.join(dir, "core"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "core", "products.json"),
    JSON.stringify([{ name: "Test", slug: "test" }]),
    "utf-8"
  );
  fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
  fs.mkdirSync(path.join(dir, "routines"), { recursive: true });
  return dir;
}

function runDoctor(
  cwd: string,
  extraEnv: Record<string, string> = {}
): { stdout: string; status: number | null } {
  // Strip any pre-set messenger-related env so the .env file is the sole source.
  const baseEnv = { ...process.env };
  for (const k of Object.keys(baseEnv)) {
    if (k.startsWith("MESSENGER") || k.startsWith("SLACK_") || k.startsWith("DISCORD_") || k.startsWith("TELEGRAM_") || k === "REPOS_BASE_PATH") {
      delete baseEnv[k];
    }
  }
  const useShell = process.platform === "win32";
  const cmd = useShell ? "npx" : "npx";
  const cmdline = useShell ? `npx tsx "${BIN}" doctor` : "npx";
  const res = useShell
    ? spawnSync(cmdline, [], {
        cwd,
        env: { ...baseEnv, ...extraEnv },
        encoding: "utf-8",
        shell: true,
      })
    : spawnSync(cmd, ["tsx", BIN, "doctor"], {
        cwd,
        env: { ...baseEnv, ...extraEnv },
        encoding: "utf-8",
      });
  return { stdout: (res.stdout || "") + (res.stderr || ""), status: res.status };
}

test("dotenv loads .env into process.env (no divergence)", () => {
  const ws = makeWorkspace(
    [
      "MESSENGER=discord",
      "DISCORD_TOKEN=test.token.placeholder",
      `REPOS_BASE_PATH=${os.tmpdir()}`,
      "",
    ].join("\n")
  );
  try {
    const { stdout } = runDoctor(ws);
    assert.match(
      stdout,
      /MESSENGER set \(process\.env\)/,
      "doctor should read MESSENGER from process.env"
    );
    assert.doesNotMatch(
      stdout,
      /\.env vs process\.env mismatch/,
      "no divergence warning expected when dotenv is loaded"
    );
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test("doctor detects shell override divergence", () => {
  const ws = makeWorkspace(
    [
      "MESSENGER=slack",
      "SLACK_BOT_TOKEN=xoxb-from-dotenv",
      "SLACK_APP_TOKEN=xapp-from-dotenv",
      `REPOS_BASE_PATH=${os.tmpdir()}`,
      "",
    ].join("\n")
  );
  try {
    const { stdout } = runDoctor(ws, { SLACK_BOT_TOKEN: "xoxb-shell-override" });
    assert.match(
      stdout,
      /\.env vs process\.env mismatch/,
      "expected divergence warning when shell overrides .env"
    );
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});
