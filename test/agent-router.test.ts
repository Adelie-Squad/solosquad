import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildRoutes,
  resolve,
  rebuildRoutes,
  installRoutes,
  getCurrentRoutes,
  tickCooldowns,
  type RouteIndex,
} from "../src/bot/agent-router.js";

/**
 * v0.5 §7 — frontmatter-driven router. 4-channel resolution with priority:
 * slash > explicit > keyword > freq.
 */

function makeFixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-router-"));
  return root;
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

// ---------- buildRoutes ----------

test("buildRoutes discovers triggers from frontmatter (single tier)", () => {
  const root = makeFixture();
  writeSkill(
    root,
    "strategy",
    "pmf-planner",
    `name: "pmf-planner"
description: "PMF Planner"
team: "strategy"
triggers:
  slash: ["/pmf"]
  keyword: ["pmf", "시장 적합"]
  explicit: true`,
  );
  const idx = buildRoutes({ agents_root: root, user_root: "/__nope__" });
  assert.ok(idx.slash["/pmf"]);
  assert.equal(idx.slash["/pmf"].team, "strategy");
  assert.ok(idx.keyword["pmf"]);
  assert.ok(idx.keyword["시장 적합"]);
  assert.ok(idx.explicit["pmf-planner"]);
});

test("buildRoutes v1.1 flat layout — specialists/<name>/SKILL.md takes team from frontmatter", () => {
  const root = makeFixture();
  writeSkill(
    root,
    "specialists",
    "pmf-planner",
    `name: "pmf-planner"
description: "PMF Planner (v1.1 flat)"
team: "product"
triggers:
  slash: ["/pmf"]
  keyword: ["pmf"]
  explicit: true`,
  );
  writeSkill(
    root,
    "specialists",
    "brand-marketer",
    `name: "brand-marketer"
description: "Brand Marketer (v1.1 flat)"
team: "marketing"
triggers:
  keyword: ["brand"]
  explicit: true`,
  );
  const idx = buildRoutes({ agents_root: root, user_root: "/__nope__" });
  assert.equal(idx.slash["/pmf"]?.team, "product");
  assert.equal(idx.explicit["pmf-planner"]?.team, "product");
  assert.equal(idx.explicit["brand-marketer"]?.team, "marketing");
});

test("buildRoutes v1.1 flat layout — main/<name>/SKILL.md takes team from frontmatter", () => {
  const root = makeFixture();
  writeSkill(
    root,
    "main",
    "pm",
    `name: "pm"
description: "PM main bot"
team: "product"
triggers:
  explicit: true`,
  );
  writeSkill(
    root,
    "main",
    "engineer",
    `name: "engineer"
description: "Engineer main bot"
team: "engineering"
triggers:
  explicit: true`,
  );
  const idx = buildRoutes({ agents_root: root, user_root: "/__nope__" });
  assert.equal(idx.explicit["pm"]?.team, "product");
  assert.equal(idx.explicit["engineer"]?.team, "engineering");
});

test("buildRoutes coexistence — v1.0.x nested + v1.1 flat in the same scan", () => {
  const root = makeFixture();
  writeSkill(
    root,
    "strategy",
    "old-pmf-planner",
    `name: "old-pmf-planner"
description: "Legacy nested layout"
team: "strategy"
triggers:
  explicit: true`,
  );
  writeSkill(
    root,
    "specialists",
    "new-pmf-planner",
    `name: "new-pmf-planner"
description: "New flat layout"
team: "product"
triggers:
  explicit: true`,
  );
  const idx = buildRoutes({ agents_root: root, user_root: "/__nope__" });
  assert.equal(idx.explicit["old-pmf-planner"]?.team, "strategy");
  assert.equal(idx.explicit["new-pmf-planner"]?.team, "product");
});

test("buildRoutes silently skips SKILL.md without frontmatter (pre-S5 state)", () => {
  const root = makeFixture();
  const dir = path.join(root, "strategy", "legacy");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    "# Legacy\n\nNo frontmatter here.\n",
    "utf-8",
  );
  const idx = buildRoutes({ agents_root: root, user_root: "/__nope__" });
  assert.equal(Object.keys(idx.keyword).length, 0);
  assert.equal(Object.keys(idx.explicit).length, 0);
});

test("buildRoutes skips _meta and _teams folders (handled by separate scanners)", () => {
  const root = makeFixture();
  writeSkill(
    root,
    "_meta",
    "workflow-maker",
    `name: "workflow-maker"\ndescription: "meta"\ntriggers:\n  explicit: true`,
  );
  writeSkill(
    root,
    "strategy",
    "real",
    `name: "real"\ndescription: "real one"\ntriggers:\n  keyword: ["realsig"]`,
  );
  const idx = buildRoutes({ agents_root: root, user_root: "/__nope__" });
  assert.ok(!idx.explicit["workflow-maker"]);
  assert.ok(idx.keyword["realsig"]);
});

test("buildRoutes 3-tier override — org local beats user global beats workspace bundle", () => {
  // Same agent name + same shared trigger across all 3 tiers; org must win.
  const wsRoot = makeFixture();
  const userRoot = makeFixture();
  const orgWsRoot = makeFixture();

  // Shared keyword "dup" + shared explicit registration appear in all tiers.
  // The map keys collide, so registration order (lowest → highest priority)
  // makes the org tier overwrite the others.
  const shared = (label: string) =>
    `name: "duplicate"
description: "${label} tier"
team: "strategy"
triggers:
  keyword: ["dup"]
  explicit: true`;

  writeSkill(wsRoot, "strategy", "duplicate", shared("workspace"));
  writeSkill(userRoot, "strategy", "duplicate", shared("user"));
  const orgAgentsRoot = path.join(orgWsRoot, "acme", ".agents");
  writeSkill(orgAgentsRoot, "strategy", "duplicate", shared("org"));

  const idx = buildRoutes({
    agents_root: wsRoot,
    user_root: userRoot,
    org: "acme",
    workspace_root: orgWsRoot,
  });

  assert.equal(idx.keyword["dup"].tier, "org", "keyword channel must reflect org override");
  assert.equal(
    idx.explicit["duplicate"].tier,
    "org",
    "explicit channel must reflect org override",
  );
});

test("buildRoutes 2-tier override — user beats workspace when org is absent", () => {
  const wsRoot = makeFixture();
  const userRoot = makeFixture();

  const shared = (label: string) =>
    `name: "dup2"
description: "${label}"
team: "strategy"
triggers:
  keyword: ["d2"]
  explicit: true`;

  writeSkill(wsRoot, "strategy", "dup2", shared("workspace"));
  writeSkill(userRoot, "strategy", "dup2", shared("user"));

  const idx = buildRoutes({ agents_root: wsRoot, user_root: userRoot });
  assert.equal(idx.keyword["d2"].tier, "user");
  assert.equal(idx.explicit["dup2"].tier, "user");
});

// ---------- resolve() ----------

function makeIndex(rule: (idx: RouteIndex) => void): RouteIndex {
  const idx: RouteIndex = { slash: {}, keyword: {}, freq: [], explicit: {} };
  rule(idx);
  return idx;
}

const ref = {
  team: "strategy",
  name: "pmf-planner",
  source_path: "<fixture>",
  tier: "workspace" as const,
  stateful: false,
};

test("resolve: slash wins over keyword", () => {
  const idx = makeIndex((i) => {
    i.slash["/pmf"] = ref;
    i.keyword["pmf"] = { ...ref, name: "other" };
  });
  const result = resolve("/pmf foo bar", idx);
  assert.equal(result?.channel, "slash");
  assert.equal(result?.ref.name, "pmf-planner");
});

test("resolve: explicit marker beats keyword", () => {
  const idx = makeIndex((i) => {
    i.explicit["pmf-planner"] = ref;
    i.keyword["pmf"] = { ...ref, name: "other" };
  });
  const result = resolve("hello [explicit:pmf-planner] tell me about pmf", idx);
  assert.equal(result?.channel, "explicit");
});

test("resolve: keyword case-insensitive substring match", () => {
  const idx = makeIndex((i) => {
    i.keyword["pmf"] = ref;
  });
  const r1 = resolve("Need PMF help", idx);
  const r2 = resolve("Need help", idx);
  assert.equal(r1?.channel, "keyword");
  assert.equal(r2, null);
});

test("resolve: freq matches when cumulative score crosses threshold", () => {
  const idx = makeIndex((i) => {
    i.freq.push({
      ref,
      keywords: ["등기부", "부동산"],
      window_turns: 10,
      threshold: 3,
      cooldown_turns: 6,
    });
  });
  const history = [
    { text: "오늘 등기부 좀 봐줘" },
    { text: "부동산 신호 어떻게 잡지?" },
    { text: "또 등기부 알림 왔어" },
  ];
  const result = resolve("뭔가 새로운 거 있어?", idx, { history });
  assert.equal(result?.channel, "freq");
  assert.ok((result?.freq_score ?? 0) >= 3);
  assert.deepEqual(result?.start_cooldown, {
    skill_name: "pmf-planner",
    turns: 6,
  });
});

test("resolve: freq below threshold returns null", () => {
  const idx = makeIndex((i) => {
    i.freq.push({
      ref,
      keywords: ["foo"],
      window_turns: 10,
      threshold: 5,
      cooldown_turns: 6,
    });
  });
  const result = resolve("foo bar", idx, { history: [{ text: "foo" }] });
  assert.equal(result, null);
});

test("resolve: freq honors cooldown — skill in cooldown is skipped", () => {
  const idx = makeIndex((i) => {
    i.freq.push({
      ref,
      keywords: ["x"],
      window_turns: 10,
      threshold: 1,
      cooldown_turns: 6,
    });
  });
  const history = [{ text: "x x x" }];
  const cooledDown = { "pmf-planner": 3 };
  const result = resolve("plain msg", idx, { history, freq_cooldowns: cooledDown });
  assert.equal(result, null);
});

// ---------- tickCooldowns ----------

test("tickCooldowns decrements all entries by 1", () => {
  const out = tickCooldowns({ a: 3, b: 1, c: 2 });
  assert.deepEqual(out, { a: 2, c: 1 });
});

test("tickCooldowns is pure (does not mutate input)", () => {
  const input = { a: 2 };
  tickCooldowns(input);
  assert.deepEqual(input, { a: 2 });
});

// ---------- Module-level routeIndexRef ----------

test("rebuildRoutes installs the freshly-built index", () => {
  const root = makeFixture();
  writeSkill(
    root,
    "strategy",
    "x",
    `name: "x"\ndescription: "y"\ntriggers:\n  keyword: ["foo"]`,
  );
  rebuildRoutes({ agents_root: root, user_root: "/__nope__" });
  const cur = getCurrentRoutes();
  assert.ok(cur, "expected installed index");
  assert.ok(cur!.keyword["foo"]);
});

test("installRoutes replaces the module-level ref directly (for tests)", () => {
  const idx: RouteIndex = { slash: {}, keyword: { hello: ref }, freq: [], explicit: {} };
  installRoutes(idx);
  assert.equal(getCurrentRoutes(), idx);
});
