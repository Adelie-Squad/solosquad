import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isSecretKey,
  maskEnvContent,
  maskEnvFile,
  loadUserSecretKeys,
} from "../src/util/secrets.js";

test("isSecretKey matches builtin patterns", () => {
  assert.equal(isSecretKey("DISCORD_TOKEN"), true);
  assert.equal(isSecretKey("SLACK_BOT_TOKEN"), true);
  assert.equal(isSecretKey("ANTHROPIC_API_KEY"), true);
  assert.equal(isSecretKey("SOMETHING_SECRET"), true);
  assert.equal(isSecretKey("AWS_SECRET_ACCESS_KEY"), true);
  assert.equal(isSecretKey("DB_PASSWORD"), true);
  assert.equal(isSecretKey("VAULT_CREDENTIAL"), true);
});

test("isSecretKey does NOT match operational variables", () => {
  assert.equal(isSecretKey("WORKSPACE_NAME"), false);
  assert.equal(isSecretKey("TIMEZONE"), false);
  assert.equal(isSecretKey("MESSENGER"), false);
  assert.equal(isSecretKey("TZ"), false);
  assert.equal(isSecretKey("REPOS_BASE_PATH"), false);
});

test("maskEnvContent redacts secrets, preserves operational variables and comments", () => {
  const env = [
    "# Header comment",
    "MESSENGER=discord",
    "DISCORD_TOKEN=MTI3OD.abcdef.xyz",
    "WORKSPACE_NAME=myworkspace",
    "ANTHROPIC_API_KEY=sk-ant-api03-XXXX",
    "TIMEZONE=Asia/Seoul",
    "",
  ].join("\n");

  const result = maskEnvContent(env, { nowIso: "2026-05-15T00:00:00.000Z" });
  assert.deepEqual(result.redactedKeys.sort(), ["ANTHROPIC_API_KEY", "DISCORD_TOKEN"]);
  assert.deepEqual(result.preservedKeys.sort(), ["MESSENGER", "TIMEZONE", "WORKSPACE_NAME"]);
  // Secret values are gone
  assert.equal(result.masked.includes("MTI3OD.abcdef.xyz"), false);
  assert.equal(result.masked.includes("sk-ant-api03-XXXX"), false);
  // Operational values preserved
  assert.match(result.masked, /WORKSPACE_NAME=myworkspace/);
  assert.match(result.masked, /MESSENGER=discord/);
  assert.match(result.masked, /TIMEZONE=Asia\/Seoul/);
  // Comment preserved
  assert.match(result.masked, /^# Header comment$/m);
  // Timestamp embedded
  assert.match(result.masked, /\*\*\*REDACTED-AT-2026-05-15T00:00:00.000Z\*\*\*/);
});

test("maskEnvFile writes the masked content in place", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-secrets-"));
  const envPath = path.join(tmp, ".env");
  fs.writeFileSync(envPath, "DISCORD_TOKEN=real-token-value\nNAME=ok\n");
  const r = maskEnvFile(envPath);
  assert.equal(r.redactedKeys[0], "DISCORD_TOKEN");
  const after = fs.readFileSync(envPath, "utf-8");
  assert.equal(after.includes("real-token-value"), false);
  assert.match(after, /NAME=ok/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("maskEnvFile dry-run leaves the file untouched", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-secrets-"));
  const envPath = path.join(tmp, ".env");
  const before = "DISCORD_TOKEN=real-token-value\n";
  fs.writeFileSync(envPath, before);
  const r = maskEnvFile(envPath, { dryRun: true });
  assert.equal(r.redactedKeys[0], "DISCORD_TOKEN");
  const after = fs.readFileSync(envPath, "utf-8");
  assert.equal(after, before);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("loadUserSecretKeys reads patterns from .solosquad/secret-keys.txt", () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "ss-secretkeys-"));
  fs.mkdirSync(path.join(ws, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(ws, ".solosquad", "secret-keys.txt"),
    "# user-defined\nMY_VAULT_*\n*INTERNAL_AUTH*\n",
  );
  const patterns = loadUserSecretKeys(ws);
  assert.deepEqual(patterns, ["MY_VAULT_*", "*INTERNAL_AUTH*"]);
  fs.rmSync(ws, { recursive: true, force: true });
});

test("user-defined patterns extend masking", () => {
  const result = maskEnvContent("MY_VAULT_AUTH=top\nOK=keep\n", { extraPatterns: ["MY_VAULT_*"] });
  assert.deepEqual(result.redactedKeys, ["MY_VAULT_AUTH"]);
  assert.equal(result.masked.includes("top"), false);
  assert.match(result.masked, /OK=keep/);
});
