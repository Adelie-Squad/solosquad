import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * v1.0.3 — guild-org binding regression catcher (source-level).
 *
 * Pre-v1.0.3 `syncGuildProductMapping` matched `guild.name.includes(product.name)`
 * — a v0.1.x heuristic that silently failed for users whose Discord server
 * name did not contain their internal SoloSquad org slug. v1.0.3 trusts
 * `ownOrgSlug` (already resolved by `channel-bootstrap.resolveBotIdentity`)
 * and binds the current guild to that org directly.
 *
 * These tests inspect the discord-adapter source to assert the v0.1.x
 * heuristic is gone and the new ownOrgSlug-driven path is present. A
 * full Discord client mock would require shipping a Discord.js test
 * harness that we don't otherwise need — source-level catchers are the
 * pragmatic option for these wiring assertions.
 */

const ADAPTER_PATH = path.resolve(process.cwd(), "src/messenger/discord-adapter.ts");

test("v1.0.3 — discord-adapter no longer uses guild.name.includes(product.*) heuristic", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  assert.equal(
    /guild\.name\.includes\s*\(\s*product\./.test(src),
    false,
    "v0.1.x guild.name.includes(product.*) heuristic must be gone (false negative source)",
  );
  assert.equal(
    /guild\.name\.toLowerCase\(\)\.includes\s*\(\s*product\./.test(src),
    false,
    "v0.1.x guild.name.toLowerCase().includes(product.*) heuristic must be gone",
  );
});

test("v1.0.3 — syncGuildProductMapping is gated on ownOrgSlug", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // The new path: bail when ownOrgSlug is not set, then use it to find the config.
  assert.match(
    src,
    /syncGuildProductMapping[\s\S]{0,400}!this\.ownOrgSlug/,
    "syncGuildProductMapping must early-return when ownOrgSlug is unset",
  );
});

test("v1.0.3 — getProductByGuild uses ownOrgSlug (no name-matching scan)", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  assert.match(
    src,
    /getProductByGuild[\s\S]{0,400}this\.ownOrgSlug/,
    "getProductByGuild must consult ownOrgSlug, not iterate all products by name",
  );
});

test("v1.0.3 — bound-guild log uses 'Bound guild ... → org=' wording", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // The new explicit log line replaces the old `[Discord] Mapped: ↔` heuristic log.
  assert.match(
    src,
    /Bound guild [^"`']*org=/,
    "discord-adapter must log 'Bound guild ... → org=...' when binding (v1.0.3 explicit-decision log)",
  );
});
