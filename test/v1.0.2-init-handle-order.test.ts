import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * v1.0.2 — init wizard step-order regression catcher.
 *
 * Pre-v1.0.2 had the handle prompt at Step 5.2 — after timezone +
 * workspace.yaml + org + repos — leaving 4 unrelated prompts between the
 * messenger token entry and the handle confirmation. v1.0.2 moved the
 * handle prompt to Step 3.5 (right after token entry) so the wizard's
 * narrative reads "you just connected your Discord token → now confirm
 * how you'll be known on that messenger". The yaml write itself is
 * deferred to Step 6 (after the org dir exists).
 *
 * This catcher asserts the *textual order* of step banners in init.ts.
 * If someone re-reorders or restores the old 5.2 layout, this trips.
 */

const INIT_PATH = path.resolve(process.cwd(), "src/cli/init.ts");

function uniqueStepNumbers(src: string): Set<string> {
  const re = /chalk\.bold\(\s*["'`][^"'`]*-- Step ([0-9.]+)[^"'`]*["'`]/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    out.add(m[1]);
  }
  return out;
}

test("v1.0.2 — init.ts has the expected step banner set (no Step 5/5.1/5.2/6.5)", () => {
  const src = fs.readFileSync(INIT_PATH, "utf-8");
  const present = uniqueStepNumbers(src);

  // v1.0.2 wizard banners (set, not file-order — Step 1.5's function
  // definition appears above Step 1 in the source but runs after):
  //   1, 1.5, 2, 3, 3.5 (NEW — Your Handle), 4, 6, 6.1, 7, 7.5, 8
  // Step 5 (workspace.yaml) is intentionally silent (no banner).
  // Old banners that MUST be absent: 5, 5.1, 5.2, 6.5 (those numbers got
  // renumbered to 6, 6.1, 7.5; 5.2 was deleted and merged into 3.5).
  for (const want of ["1", "1.5", "2", "3", "3.5", "4", "6", "6.1", "7", "7.5", "8"]) {
    assert.ok(present.has(want), `missing Step ${want} banner`);
  }
  for (const absent of ["5", "5.1", "5.2", "6.5"]) {
    assert.equal(
      present.has(absent),
      false,
      `old Step ${absent} banner must be gone (renumbered or merged in v1.0.2)`,
    );
  }
});

test("v1.0.2 — Step 3.5 'Your Handle' immediately follows token saveEnv", () => {
  const src = fs.readFileSync(INIT_PATH, "utf-8");
  const tokenSaveIdx = src.indexOf(".solosquad/.env saved");
  const handleStepIdx = src.indexOf("Step 3.5: Your Handle");
  assert.ok(tokenSaveIdx > 0, "expected '.solosquad/.env saved' marker in init.ts");
  assert.ok(handleStepIdx > 0, "expected 'Step 3.5: Your Handle' banner in init.ts");
  assert.ok(
    handleStepIdx > tokenSaveIdx,
    "Step 3.5 Handle banner must come AFTER the .env saved marker (token connection precedes identity)",
  );

  // No other Step banner should sit between them — Step 3.5 is the direct
  // narrative continuation of the token entry.
  const between = src.slice(tokenSaveIdx, handleStepIdx);
  assert.equal(
    /-- Step [0-9.]+:/.test(between),
    false,
    "no Step banner may appear between token saveEnv and Step 3.5 (narrative connectivity)",
  );
});

test("v1.0.2 — handle prompt copy includes unique-in-messenger guidance", () => {
  const src = fs.readFileSync(INIT_PATH, "utf-8");
  // The guidance text must mention picking a handle different from other
  // messenger members (avoids chat-confusion).
  assert.match(
    src,
    /unique in your messenger/i,
    "Step 3.5 must include 'unique in your messenger' guidance copy",
  );
  assert.match(
    src,
    /usernames or display names/i,
    "guidance must reference 'usernames or display names' of other members",
  );
});
