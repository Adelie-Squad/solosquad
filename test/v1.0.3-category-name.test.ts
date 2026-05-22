import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * v1.0.3 — Discord channel category name regression catcher.
 *
 * Pre-v1.0.3 the bot created its category as "AI Team Reports" (v0.1.x
 * agent-team-as-product vocab). v1.0.3 renames new creations to
 * "solosquad" while still matching the legacy name so existing installs
 * keep their channel-parent relationship intact.
 *
 * Source-level catcher — spinning up a real Discord client in unit tests
 * is out of scope. We verify the adapter's category lookup includes both
 * names AND that the create-call uses the new canonical name.
 */

const ADAPTER_PATH = path.resolve(process.cwd(), "src/messenger/discord-adapter.ts");

test("v1.0.3 — ensureChannels category lookup includes both 'solosquad' and 'AI Team Reports'", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // CATEGORY_NAMES tuple (or equivalent literal pair) must contain both.
  assert.match(src, /"solosquad"/, "must reference canonical 'solosquad' literal");
  assert.match(
    src,
    /"AI Team Reports"/,
    "must still reference legacy 'AI Team Reports' for backward-compat lookup",
  );
});

test("v1.0.3 — new category creation uses 'solosquad' (not the legacy name)", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // The channels.create({ name: ..., type: GuildCategory }) call.
  // Look for the create-call name field set to "solosquad" within the
  // ensureChannels block (matching across a few lines).
  assert.match(
    src,
    /channels\.create\(\s*\{[\s\S]{0,150}name:\s*"solosquad"[\s\S]{0,150}GuildCategory/,
    "category create() must use name: 'solosquad'",
  );
  // And NOT use the legacy name as the create target.
  assert.equal(
    /channels\.create\(\s*\{[\s\S]{0,150}name:\s*"AI Team Reports"[\s\S]{0,150}GuildCategory/.test(src),
    false,
    "category create() must not use legacy name 'AI Team Reports' for new creations",
  );
});

test("v1.0.3 — adapter does not force-rename legacy categories (no setName call on category)", () => {
  const src = fs.readFileSync(ADAPTER_PATH, "utf-8");
  // We deliberately do NOT rename existing "AI Team Reports" categories —
  // requires ManageChannels permission and might fight a user who chose
  // a different name on purpose. If a future change introduces setName
  // on the resolved category, this trip-wire surfaces it for review.
  assert.equal(
    /category[\.\s]*setName\s*\(/.test(src),
    false,
    "adapter must not call category.setName() — legacy categories stay untouched (v1.0.3 design)",
  );
});
