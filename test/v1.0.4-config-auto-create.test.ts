import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * v1.0.4 — discord-adapter source-level regression catcher.
 *
 * Pre-v1.0.4 `syncGuildProductMapping` silently returned when
 * `<org>/discord/config.yaml` was missing — and `scaffoldOrg` never
 * created that file, so every fresh `solosquad init` workspace produced
 * the "No product linked" error on the first message. v1.0.4 switched to
 * load-or-empty + auto-write: the function now creates the file when
 * absent using info the bot already has (ownOrgSlug + guild).
 *
 * We assert at the source level that the old silent bail is gone and the
 * new auto-write path is in place. (Spinning up a real Discord client
 * mock in unit tests is out of scope for this hotfix.)
 */

const ADAPTER_PATH = path.resolve(process.cwd(), "src/messenger/discord-adapter.ts");

test("v1.0.4 — discord-adapter no longer early-returns when config.yaml is missing", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // Find the syncGuildProductMapping function body and inspect its
  // top-of-function bail conditions.
  const match = src.match(/private syncGuildProductMapping\([\s\S]*?\}\n\s{2}\}/);
  assert.ok(match, "expected to find syncGuildProductMapping in discord-adapter.ts");
  const body = match[0];
  // The pre-v1.0.4 silent bail looked like:
  //   if (!fs.existsSync(configFile)) return;
  // It must be gone — the new code loads-or-empties instead.
  assert.equal(
    /if\s*\(\s*!fs\.existsSync\(\s*configFile\s*\)\s*\)\s*return/.test(body),
    false,
    "syncGuildProductMapping must NOT silently return when config.yaml is missing (v1.0.4 fix)",
  );
});

test("v1.0.4 — discord-adapter uses load-or-empty pattern for config", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // The new code reads the config when it exists, or starts with `{}`
  // when it doesn't — then proceeds to write it back. Look for the
  // ternary load-or-empty.
  assert.match(
    src,
    /fs\.existsSync\(\s*configFile\s*\)[\s\S]{0,300}\?[\s\S]{0,300}:\s*\(?\{\s*\}/,
    "syncGuildProductMapping must use a load-or-empty (ternary) pattern that yields {} when config.yaml is missing",
  );
});

test("v1.0.4 — discord-adapter ensures the discord/ directory exists before writing", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // Auto-create the dir so writeFileSync can't ENOENT on first run.
  assert.match(
    src,
    /fs\.mkdirSync\([^)]*configDir[\s\S]{0,80}recursive:\s*true/,
    "syncGuildProductMapping must mkdir -p configDir before writing config.yaml",
  );
});

test("v1.0.4 — discord-adapter writes 'Bound guild ... → org=' log on first successful bind", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  assert.match(
    src,
    /Bound guild [^"`']*org=/,
    "discord-adapter must log 'Bound guild ... → org=...' when binding (preserved from v1.0.3)",
  );
});
