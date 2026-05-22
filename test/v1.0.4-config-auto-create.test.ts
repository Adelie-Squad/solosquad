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

test("v1.0.4 — generic 'No product linked' is replaced with diagnostic reason + actionable hint", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // Per 9-reference research Best Practice 5 (Discord ↔ AI agent
  // connection): silent or generic failure messages are the primary
  // cause of repeated regression. v1.0.4 routes the failure through a
  // diagnoseProductByGuildFailure helper that names the failed hop.
  assert.match(
    src,
    /diagnoseProductByGuildFailure/,
    "discord-adapter must define diagnoseProductByGuildFailure helper",
  );
  assert.match(
    src,
    /Bot can't find a SoloSquad org bound to/,
    "user-facing message must name the guild and the diagnosed reason",
  );
  assert.match(
    src,
    /solosquad doctor/,
    "diagnostic message must surface 'solosquad doctor' as actionable next step",
  );
  // The pre-v1.0.4 generic message must be gone.
  assert.equal(
    /No product linked to this server\. Re-run `solosquad init`\./.test(src),
    false,
    "generic 'No product linked' message must be replaced with the diagnostic variant",
  );
});

test("v1.0.4 — diagnoseProductByGuildFailure names each of the 5 binding hops", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // Per the 9-reference research, every hop in the binding chain should
  // be individually attributable so future regressions don't return to
  // the silent-fail era. We assert the diagnostic strings are present in
  // the adapter source — extracting the exact method body with regex is
  // brittle across formatter changes, so we grep the full file instead
  // and rely on these strings being unique to the helper.
  assert.match(src, /bot has no resolved org/, "must report the ownOrgSlug null case (hop 3)");
  assert.match(src, /config\.yaml missing at/, "must report config.yaml missing case (hop 4a)");
  assert.match(src, /no guild_id field/, "must report missing guild_id case (hop 4b)");
  assert.match(src, /but message came from guild/, "must report guild_id mismatch case (hop 4c)");
  assert.match(src, /loadProducts\(\) does not include org/, "must report loadProducts mismatch case (hop 5)");
});
