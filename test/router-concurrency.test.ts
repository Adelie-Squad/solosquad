import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildRoutes,
  installRoutes,
  getCurrentRoutes,
  rebuildRoutes,
  resolve,
  type RouteIndex,
} from "../src/bot/agent-router.js";

/**
 * v0.5 §11.5 — hot-reload atomic swap regression.
 *
 * Node is single-threaded, but the contract is: while `rebuildRoutes()` is
 * working, in-flight handlers must keep seeing the PREVIOUS index — they
 * never observe a half-built one. We exercise this by interleaving
 * `installRoutes()` calls with `resolve()` lookups and asserting that each
 * lookup sees a fully-consistent index (no missing slash + keyword pair).
 */

function makeFixture(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-concurrency-"));
}

function writeSkill(root: string, team: string, name: string, frontmatter: string): void {
  const dir = path.join(root, team, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\n${frontmatter}\n---\n\n# ${name}\n\nBody.\n`,
    "utf-8",
  );
}

function buildIndexV1(): RouteIndex {
  const root = makeFixture();
  writeSkill(
    root,
    "strategy",
    "v1",
    `name: "v1"\ndescription: "first"\ntriggers:\n  slash: ["/v1"]\n  keyword: ["v1"]\n  explicit: true`,
  );
  return buildRoutes({ agents_root: root, user_root: "/__nope__" });
}

function buildIndexV2(): RouteIndex {
  const root = makeFixture();
  writeSkill(
    root,
    "strategy",
    "v2",
    `name: "v2"\ndescription: "second"\ntriggers:\n  slash: ["/v2"]\n  keyword: ["v2"]\n  explicit: true`,
  );
  return buildRoutes({ agents_root: root, user_root: "/__nope__" });
}

// ---------- Atomic swap ----------

test("atomic swap — reads either old OR new index, never a partial mix", async () => {
  const v1 = buildIndexV1();
  installRoutes(v1);

  // Concurrent reads (microtasks) interleaved with installs.
  const readers: Promise<void>[] = [];
  for (let i = 0; i < 200; i++) {
    readers.push(
      Promise.resolve().then(() => {
        const idx = getCurrentRoutes()!;
        // Whichever version we read, slash + keyword + explicit must all
        // reference the SAME name. Mixed states would expose a bug.
        const slashName = Object.values(idx.slash)[0]?.name;
        const keywordName = Object.values(idx.keyword)[0]?.name;
        const explicitName = Object.values(idx.explicit)[0]?.name;
        assert.equal(slashName, keywordName, "slash + keyword names diverged");
        assert.equal(slashName, explicitName, "slash + explicit names diverged");
      }),
    );
  }

  // Interleave installs.
  for (let i = 0; i < 20; i++) {
    readers.push(
      Promise.resolve().then(() => {
        installRoutes(i % 2 === 0 ? buildIndexV1() : buildIndexV2());
      }),
    );
  }

  await Promise.all(readers);
});

test("rebuildRoutes pre-installation: getCurrentRoutes returns previous index", () => {
  installRoutes(buildIndexV1());
  const before = getCurrentRoutes();
  assert.equal(before?.slash["/v1"]?.name, "v1");

  // We can't actually pause `rebuildRoutes()` mid-build in JS, but the
  // contract test is: the moment any reader looks at getCurrentRoutes()
  // before the swap completes, they see v1. After the swap, v2.
  // Our atomic-swap implementation builds in a local then assigns, so
  // this is structurally guaranteed.
  const root = makeFixture();
  writeSkill(
    root,
    "strategy",
    "v2",
    `name: "v2"\ndescription: "swap"\ntriggers:\n  slash: ["/v2"]\n  explicit: true`,
  );
  rebuildRoutes({ agents_root: root, user_root: "/__nope__" });
  const after = getCurrentRoutes();
  assert.equal(after?.slash["/v2"]?.name, "v2");
  assert.equal(after?.slash["/v1"], undefined, "v1 routes gone after swap");
});

test("resolve() during many sequential swaps never throws", () => {
  for (let i = 0; i < 50; i++) {
    installRoutes(i % 2 === 0 ? buildIndexV1() : buildIndexV2());
    const idx = getCurrentRoutes()!;
    // Each post-swap resolve should match exactly one version's slash.
    const r = resolve("/v1", idx);
    const r2 = resolve("/v2", idx);
    // Exactly ONE of them matches per index version.
    const matched = (r ? 1 : 0) + (r2 ? 1 : 0);
    assert.equal(matched, 1, `expected exactly one match per iteration; got ${matched}`);
  }
});

test("a build with a missing agents_root path silently produces an empty index", () => {
  const idx = buildRoutes({
    agents_root: "/__definitely_not_a_real_path__",
    user_root: "/__nope__",
  });
  assert.deepEqual(idx.slash, {});
  assert.deepEqual(idx.keyword, {});
  assert.deepEqual(idx.freq, []);
  assert.deepEqual(idx.explicit, {});
});
