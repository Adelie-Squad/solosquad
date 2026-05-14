import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";

import { migration as v050ToV060 } from "../src/migrations/scripts/0.5.0-to-0.6.0.js";
import { __test as M } from "../src/migrations/scripts/0.5.0-to-0.6.0.js";
import { loadLedger, getPendingV06 } from "../src/analyze/ledger.js";
import { orgAgentProfilePath } from "../src/util/agent-profile.js";

/**
 * Read the raw ledger YAML rather than going through `loadLedger` — the
 * v0.5 ledger parser strips unknown fields (`human_review_required`,
 * `redestination_method`, …) per the v0.5 frozen-module contract. The v0.6
 * migration *writes* those fields back out via `js-yaml.dump` so the
 * receiver-side report and a subsequent migrate --apply re-run can recover.
 */
function readLedgerRaw(file: string): {
  analyzed: Record<string, unknown>[];
} {
  const raw = yaml.load(fs.readFileSync(file, "utf-8")) as {
    analyzed: Record<string, unknown>[];
  };
  return raw;
}

/**
 * v0.6 ledger redestination (v0.6 plan §2.2 receiver-side). Covers:
 *
 *   1. Only entries with `pending_v0.6_redestination: true` are processed.
 *   2. `classification: role` — heuristic extracts H2/H3 sections matching the
 *      org-color keyword set and merges them into `<org>/agent-profile.yaml`.
 *   3. `classification: domain` — `<org>/memory/domain/*.md` is moved to
 *      `<org>/domain/*.md`.
 *   4. Heuristic fail-soft — body with 0 matches stays in place with
 *      `human_review_required: true`.
 *   5. Redestination report (`migration-<date>-redestination.md`) is written
 *      with auto/human/budget buckets.
 *   6. `migration-costs.jsonl` accumulates one row per processed entry.
 *   7. Budget cap reached → remaining entries flagged human-review and the
 *      migration completes without throwing.
 */

interface SeedLedgerEntry {
  path: string;
  hash: string;
  classification: "role" | "domain" | "codebase-fact" | "workflow";
  /**
   * Where the v0.5 applier dropped the source asset. May be `{ws}/...` style
   * (absolute path under the temp workspace), `~/.solosquad/...` (homedir),
   * or any string. The helper resolves `{ws}/...` to the actual temp dir.
   */
  destination: string;
  confidence?: number;
  applied?: boolean;
  pending?: boolean;
}

function tempV050Workspace(opts: {
  org?: string;
  ledger?: SeedLedgerEntry[];
  files?: { path: string; content: string }[];
  preProfile?: { org: string; body: string };
  preMigrationCosts?: { org: string; rows: { usd: number }[] };
  budgetUsd?: number;
}): string {
  const org = opts.org ?? "acme";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-mig060-led-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });

  const wsYamlLines = [
    "version: 0.5.0",
    "display_name: test-workspace",
    "skill_loader: { tiers: [org, user, bundle] }",
    "author: { budget: { daily_usd: 10 }, on_cap_action: pause }",
    "created_at: 2026-05-14T00:00:00Z",
  ];
  if (opts.budgetUsd !== undefined) {
    wsYamlLines.push(`migration: { budget_usd: ${opts.budgetUsd} }`);
  }
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    wsYamlLines.join("\n") + "\n",
    "utf-8",
  );

  fs.mkdirSync(path.join(dir, org, ".solosquad"), { recursive: true });
  fs.mkdirSync(path.join(dir, org, "memory"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, org, ".org.yaml"),
    `slug: ${org}\nname: ${org}\nprovider: github\ncreated_at: 2026-05-14T00:00:00Z\n`,
    "utf-8",
  );

  if (opts.files) {
    for (const f of opts.files) {
      const full = path.join(dir, f.path);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, f.content, "utf-8");
    }
  }

  if (opts.ledger) {
    const analyzed = opts.ledger.map((e) => ({
      path: e.path,
      hash: e.hash,
      classification: e.classification,
      confidence: e.confidence ?? 0.85,
      destination: resolveSeedDestination(dir, e.destination),
      applied: e.applied ?? true,
      "pending_v0.6_redestination":
        e.pending ?? (e.classification === "role" || e.classification === "domain"),
      redestinated_at: null,
    }));
    fs.writeFileSync(
      path.join(dir, org, ".solosquad", "analysis-ledger.yaml"),
      yaml.dump({
        version: 1,
        analyzed,
        model: { fingerprint: "test" },
      }),
      "utf-8",
    );
  }

  if (opts.preProfile) {
    const file = path.join(dir, opts.preProfile.org, "agent-profile.yaml");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, opts.preProfile.body, "utf-8");
  }

  if (opts.preMigrationCosts) {
    const file = path.join(
      dir,
      opts.preMigrationCosts.org,
      "memory",
      "migration-costs.jsonl",
    );
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      opts.preMigrationCosts.rows
        .map((r) =>
          JSON.stringify({
            ts: "2026-05-14T00:00:00.000Z",
            entry_path: "seed",
            usd: r.usd,
            method: "llm-fallback",
          })
        )
        .join("\n") + "\n",
      "utf-8",
    );
  }

  return dir;
}

function resolveSeedDestination(ws: string, dest: string): string {
  if (dest.startsWith("{ws}/")) return path.join(ws, dest.slice("{ws}/".length));
  return dest;
}

test("ledger: only entries with pending_v0.6_redestination=true are processed", async () => {
  const ws = tempV050Workspace({
    ledger: [
      {
        path: ".claude/skills/voice-tone.md",
        hash: "abc",
        classification: "role",
        destination: "{ws}/tmp-skills/strategy/business-strategist/SKILL.md",
        pending: true,
      },
      {
        path: ".claude/skills/codebase-tree.md",
        hash: "def",
        classification: "codebase-fact",
        destination: "<repo>/.claude/skills/codebase-tree.md",
        pending: false,
      },
    ],
    files: [
      {
        path: "tmp-skills/strategy/business-strategist/SKILL.md",
        content: [
          "---",
          "name: business-strategist",
          "team: strategy",
          "---",
          "# voice-tone",
          "",
          "## Tone",
          "",
          "Professional, conservative.",
          "",
        ].join("\n"),
      },
    ],
  });

  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const ledger = loadLedger(path.join(ws, "acme", ".solosquad", "analysis-ledger.yaml"))!;
  const role = ledger.analyzed.find((e) => e.path === ".claude/skills/voice-tone.md")!;
  const fact = ledger.analyzed.find((e) => e.path === ".claude/skills/codebase-tree.md")!;
  // The role entry was pending and now flipped to false.
  assert.equal(getPendingV06(role), false);
  // The codebase-fact entry was never pending; its flag stays untouched (false).
  assert.equal(getPendingV06(fact), false);
});

test("ledger: role classification — heuristic extracts H2 sections and merges into agent-profile.yaml", async () => {
  const srcRel = "tmp-skills/strategy/business-strategist/SKILL.md";
  const ws = tempV050Workspace({
    ledger: [
      {
        path: ".claude/skills/voice.md",
        hash: "abc",
        classification: "role",
        destination: `{ws}/${srcRel}`,
      },
    ],
    files: [
      {
        path: srcRel,
        content: [
          "---",
          "name: business-strategist",
          "team: strategy",
          "---",
          "# business-strategist",
          "",
          "## Tone",
          "",
          "Professional, no hype.",
          "",
          "## Ban phrases",
          "",
          "- 혁신적인",
          "- 게임 체인저",
          "",
          "## Some other section",
          "",
          "Unrelated body.",
          "",
        ].join("\n"),
      },
    ],
  });

  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const profileRaw = fs.readFileSync(orgAgentProfilePath(ws, "acme"), "utf-8");
  const profile = yaml.load(profileRaw) as Record<string, unknown>;
  const agent = profile["business-strategist"] as Record<string, unknown>;
  assert.ok(agent, "agent section should be merged");
  assert.match(String(agent.tone ?? ""), /Professional, no hype/);
  const bans = agent.ban_phrases as string[];
  assert.ok(Array.isArray(bans));
  assert.deepEqual(new Set(bans), new Set(["혁신적인", "게임 체인저"]));
});

test("ledger: domain classification — file is moved from memory/domain to domain/", async () => {
  const ws = tempV050Workspace({
    ledger: [
      {
        path: ".claude/skills/pricing.md",
        hash: "abc",
        classification: "domain",
        destination: "memory/domain/pricing.md",
      },
    ],
    files: [
      {
        path: "acme/memory/domain/pricing.md",
        content: "# pricing\nPricing facts.\n",
      },
    ],
  });
  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const moved = path.join(ws, "acme", "domain", "pricing.md");
  assert.ok(fs.existsSync(moved));
  const body = fs.readFileSync(moved, "utf-8");
  assert.match(body, /Pricing facts/);

  assert.equal(
    fs.existsSync(path.join(ws, "acme", "memory", "domain", "pricing.md")),
    false,
  );

  const ledger = readLedgerRaw(path.join(ws, "acme", ".solosquad", "analysis-ledger.yaml"));
  const entry = ledger.analyzed[0];
  assert.equal(entry["pending_v0.6_redestination"], false);
  assert.equal(entry["redestination_method"], "auto");
});

test("ledger: heuristic fail-soft — body with 0 matching sections is marked human_review_required", async () => {
  const srcRel = "tmp-skills/strategy/business-strategist/SKILL.md";
  const ws = tempV050Workspace({
    ledger: [
      {
        path: ".claude/skills/uncategorized.md",
        hash: "abc",
        classification: "role",
        destination: `{ws}/${srcRel}`,
      },
    ],
    files: [
      {
        path: srcRel,
        content: [
          "---",
          "name: business-strategist",
          "team: strategy",
          "---",
          "# Generic agent body",
          "",
          "## Process",
          "",
          "Generic steps.",
          "",
          "## Outputs",
          "",
          "More body.",
          "",
        ].join("\n"),
      },
    ],
  });

  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const ledger = readLedgerRaw(path.join(ws, "acme", ".solosquad", "analysis-ledger.yaml"));
  const entry = ledger.analyzed[0];
  // Still pending — flag pending=true so next run can retry after human edit.
  assert.equal(entry["pending_v0.6_redestination"], true);
  assert.equal(entry["human_review_required"], true);
  assert.equal(entry["redestination_method"], "human-review-required");
});

test("ledger: redestination report (migration-<date>-redestination.md) is written with bucket counts", async () => {
  const srcRoleColor = "tmp-skills/growth/content-writer/SKILL.md";
  const srcRoleNoColor = "tmp-skills/growth/brand-marketer/SKILL.md";
  const ws = tempV050Workspace({
    ledger: [
      {
        path: "role-with-color.md",
        hash: "a",
        classification: "role",
        destination: `{ws}/${srcRoleColor}`,
      },
      {
        path: "role-without-color.md",
        hash: "b",
        classification: "role",
        destination: `{ws}/${srcRoleNoColor}`,
      },
      {
        path: "domain-doc.md",
        hash: "c",
        classification: "domain",
        destination: "memory/domain/customers.md",
      },
    ],
    files: [
      {
        path: srcRoleColor,
        content: [
          "---",
          "name: content-writer",
          "team: growth",
          "---",
          "# content-writer",
          "",
          "## Voice",
          "",
          "Bold, direct.",
          "",
        ].join("\n"),
      },
      {
        path: srcRoleNoColor,
        content: "# brand-marketer\n\n## Process\n\nGeneric body.\n",
      },
      {
        path: "acme/memory/domain/customers.md",
        content: "# customers\nCustomer facts.\n",
      },
    ],
  });

  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const memoryDir = path.join(ws, "acme", "memory");
  const files = fs.readdirSync(memoryDir);
  const report = files.find((f) => /^migration-.*-redestination\.md$/.test(f));
  assert.ok(report, `report should be written; got ${files.join(",")}`);

  const body = fs.readFileSync(path.join(memoryDir, report!), "utf-8");
  // Template uses different wording; assert numeric summary lines instead.
  assert.match(body, /Auto-applied \(role[^|]*\|\s*1/);
  assert.match(body, /Auto-applied \(domain[^|]*\|\s*1/);
  assert.match(body, /Human review required[^|]*\|\s*1/);
  // Auto-applied entries table includes the moved domain file.
  assert.match(body, /domain-doc\.md/);
  // Human-review queue includes the role entry without color.
  assert.match(body, /role-without-color\.md/);
});

test("ledger: migration-costs.jsonl accumulates one row per processed entry", async () => {
  const srcRel = "tmp-skills/strategy/pmf-planner/SKILL.md";
  const ws = tempV050Workspace({
    ledger: [
      {
        path: "role-a.md",
        hash: "a",
        classification: "role",
        destination: `{ws}/${srcRel}`,
      },
    ],
    files: [
      {
        path: srcRel,
        content: [
          "---",
          "name: pmf-planner",
          "team: strategy",
          "---",
          "## Priorities",
          "",
          "- Retention",
          "- Activation",
          "",
        ].join("\n"),
      },
    ],
  });

  const plan = await v050ToV060.plan(ws);
  await v050ToV060.apply(ws, plan);

  const costsFile = path.join(ws, "acme", "memory", "migration-costs.jsonl");
  assert.ok(fs.existsSync(costsFile), "migration-costs.jsonl should be written");
  const rows = fs
    .readFileSync(costsFile, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  assert.equal(rows.length, 1, "one row per processed entry");
  assert.equal(rows[0].method, "heuristic");
  assert.equal(rows[0].usd, 0);
});

test("ledger: budget cap reached → remaining entries flagged human-review and run completes safely", async () => {
  const srcRel = "tmp-skills/strategy/business-strategist/SKILL.md";
  const ws = tempV050Workspace({
    budgetUsd: 1,
    preMigrationCosts: {
      org: "acme",
      rows: [{ usd: 0.6 }, { usd: 0.5 }],
    },
    ledger: [
      {
        path: "role-budget.md",
        hash: "a",
        classification: "role",
        destination: `{ws}/${srcRel}`,
      },
    ],
    files: [
      {
        path: srcRel,
        content: [
          "---",
          "name: business-strategist",
          "team: strategy",
          "---",
          "## Tone",
          "",
          "Conservative.",
          "",
        ].join("\n"),
      },
    ],
  });

  const plan = await v050ToV060.plan(ws);
  // Should not throw — budget cap should mark human-review and complete.
  await v050ToV060.apply(ws, plan);

  const ledger = readLedgerRaw(path.join(ws, "acme", ".solosquad", "analysis-ledger.yaml"));
  const entry = ledger.analyzed[0];
  assert.equal(entry["human_review_required"], true);
  assert.equal(entry["redestination_method"], "human-review-required");
  // Confirm the cumulative cost reader sees the seeded values.
  const total = M.readMigrationCostsTotal(ws, "acme");
  assert.ok(total >= 1, `cumulative cost ${total} should reach the cap of 1`);
});
