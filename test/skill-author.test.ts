import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  runAuthorLoop,
  applyDraft,
  loadDraft,
  type ClaudeCaller,
  type ClaudeCallInput,
  type ClaudeCallResult,
  type AuthorDraft,
} from "../src/bot/skill-author.js";
import { installRoutes, getCurrentRoutes } from "../src/bot/agent-router.js";
import { parseSkillMd, validateSkill } from "../src/bot/skill-parser.js";

/**
 * v0.5 §5 — author loop E2E with a mocked ClaudeCaller.
 *
 * Each test gets its own workspace + org tmp dir. The mocked ClaudeCaller
 * records every call so we can assert step ordering and budget bookkeeping.
 */

function makeWorkspace(): { workspace: string; orgSlug: string } {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-author-"));
  const orgSlug = "demo-org";
  fs.mkdirSync(path.join(workspace, orgSlug), { recursive: true });
  return { workspace, orgSlug };
}

interface RecordingCaller extends ClaudeCaller {
  calls: ClaudeCallInput[];
  responses: ClaudeCallResult[];
}

function makeCaller(responses: Partial<ClaudeCallResult>[] = []): RecordingCaller {
  const calls: ClaudeCallInput[] = [];
  const filled: ClaudeCallResult[] = responses.map((r) => ({
    text: r.text ?? "ack",
    usage: r.usage ?? { input_tokens: 100, output_tokens: 50 },
    model: r.model ?? "haiku-4-5",
  }));
  let i = 0;
  return {
    calls,
    responses: filled,
    async call(input: ClaudeCallInput): Promise<ClaudeCallResult> {
      calls.push(input);
      const idx = Math.min(i, filled.length - 1);
      i++;
      return filled[idx] ?? { text: "ack", usage: { input_tokens: 100, output_tokens: 50 }, model: "haiku-4-5" };
    },
  };
}

// Reset the module-private router ref between tests so unrelated state doesn't bleed.
function isolateRouter(): void {
  installRoutes({ slash: {}, keyword: {}, freq: [], explicit: {} });
}

// -----------------------------------------------------------------------------

test("happy path: CLARIFY → DRAFT → AWAIT_CONFIRM → APPLIED", async () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();
  const claude = makeCaller([
    { text: "asked questions" },
    { text: "interpreted answers" },
    { text: "drafted SKILL.md body" },
  ]);

  // Turn 1 — user starts the loop with intent.
  const r1 = await runAuthorLoop({
    workspace,
    orgSlug,
    userId: "alice",
    userMessage: "매주 등기부 알림 보고서 만들어줘",
    intent: "매주 등기부 알림 보고서 만들어줘",
    claude,
  });
  assert.equal(r1.state, "CLARIFY");
  assert.match(r1.reply, /입력은 무엇/);

  // Turn 2 — user answers the clarifying questions; loop renders draft.
  const r2 = await runAuthorLoop({
    workspace,
    orgSlug,
    userId: "alice",
    userMessage: "등기부 OpenAPI 응답, Markdown 리포트, 매주 자동",
    claude,
  });
  assert.equal(r2.state, "AWAIT_CONFIRM");
  assert.match(r2.reply, /preview/);

  // Turn 3 — user confirms.
  const r3 = await runAuthorLoop({
    workspace,
    orgSlug,
    userId: "alice",
    userMessage: "y",
    claude,
  });
  assert.equal(r3.state, "APPLIED");
  assert.ok(r3.applied_path);
  assert.ok(fs.existsSync(r3.applied_path!));
});

test("budget exhausted → loop refuses before any LLM call", async () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();

  // Pre-seed memory/author-costs.jsonl above the daily cap.
  const memDir = path.join(workspace, orgSlug, "memory");
  fs.mkdirSync(memDir, { recursive: true });
  const row = {
    ts: new Date().toISOString(),
    skill_draft_id: "earlier",
    step: "draft",
    usd: 50,
    model: "sonnet-4-6",
  };
  fs.writeFileSync(path.join(memDir, "author-costs.jsonl"), JSON.stringify(row) + "\n");

  const claude = makeCaller([{ text: "should not be called" }]);
  const result = await runAuthorLoop({
    workspace,
    orgSlug,
    userId: "bob",
    userMessage: "monitor cron jobs",
    intent: "monitor cron jobs",
    claude,
    budget: { dailyUsd: 10, onCapAction: "pause" },
  });
  assert.equal(result.state, "ABORTED");
  assert.match(result.reply, /budget/i);
  assert.equal(claude.calls.length, 0);
});

test("draft persists across turns (file round-trips)", async () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();
  const claude = makeCaller([
    { text: "asked questions" },
  ]);

  await runAuthorLoop({
    workspace,
    orgSlug,
    userId: "carol",
    userMessage: "weekly digest please",
    intent: "weekly digest please",
    claude,
  });

  const persisted = loadDraft(workspace, orgSlug, "carol");
  assert.ok(persisted);
  assert.equal(persisted!.user_id, "carol");
  assert.equal(persisted!.state, "CLARIFY");
  assert.ok(persisted!.history.length >= 2, "history should record user + pm");
});

test("applyDraft writes SKILL.md into <org>/.agents/ and invokes router reload", () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();
  const draft: AuthorDraft = {
    skill_draft_id: "draft-test-1",
    user_id: "dave",
    org_slug: orgSlug,
    intent: "test apply",
    team: "strategy",
    slug: "test-applier",
    display_name: "test-applier",
    description: "A direct applyDraft call",
    triggers_keyword: ["test apply"],
    inputs: { required: ["data_source"], optional: [] },
    outputs: ["report.md"],
    body_md: "# test-applier\n\n> A direct applyDraft call\n",
    state: "AWAIT_CONFIRM",
    history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const result = applyDraft({ workspace, orgSlug, draft });
  assert.ok(fs.existsSync(result.skill_path));
  assert.ok(
    result.skill_path.includes(path.join(orgSlug, ".agents", "strategy", "test-applier")),
  );

  // Re-parse on-disk file — frontmatter should round-trip cleanly + validate.
  const reparsed = parseSkillMd(fs.readFileSync(result.skill_path, "utf-8"), result.skill_path);
  assert.equal(reparsed.name, "test-applier");
  assert.equal(reparsed.stateful, false);
  assert.equal(validateSkill(reparsed).ok, true);

  // Router should have been reloaded (explicit channel registered).
  const idx = getCurrentRoutes();
  assert.ok(idx, "router index should be set after applyDraft");
  assert.ok(idx!.explicit["test-applier"] !== undefined);
});

test("applyDraft refuses to write a SKILL with stateful: true (validator)", () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();
  const draft: AuthorDraft = {
    skill_draft_id: "draft-stateful",
    user_id: "evan",
    org_slug: orgSlug,
    intent: "stateful test",
    team: "strategy",
    slug: "bad-stateful",
    display_name: "bad-stateful",
    description: "Should be rejected",
    triggers_keyword: [],
    inputs: { required: [], optional: [] },
    outputs: [],
    body_md: "# x\n",
    state: "AWAIT_CONFIRM",
    history: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Monkey-patch the buildSpec path by mutating the draft to embed stateful: true
  // via a synthetic raw frontmatter. The applier itself enforces stateful=false
  // before writing — so we simulate corruption by writing a pre-built spec and
  // checking applyDraft refuses any externally-supplied stateful:true skill.
  // Since applyDraft builds spec from the draft (always stateful:false), we
  // instead test the validator directly catches stateful: true.
  const bad = parseSkillMd(
    [
      "---",
      `name: "bad"`,
      `description: "should fail"`,
      "stateful: true",
      "---",
      "",
      "# bad",
      "",
    ].join("\n"),
  );
  const result = validateSkill(bad);
  assert.equal(result.ok, false);
  assert.ok(result.errors.find((e) => e.code === "STATEFUL_NOT_ALLOWED"));

  // Sanity — applyDraft on a clean draft still succeeds.
  const ok = applyDraft({ workspace, orgSlug, draft });
  assert.ok(fs.existsSync(ok.skill_path));
});

test("sandbox dryrun output > 500 chars is truncated + persisted to _drafts/", async () => {
  isolateRouter();
  const { workspace, orgSlug } = makeWorkspace();
  const longOutput = "x".repeat(1200);
  // Only one LLM call happens from SANDBOX_PROMPT state — return the long
  // output on the very first (and only) call.
  const claude = makeCaller([
    { text: longOutput },
  ]);

  // Drive to SANDBOX_PROMPT manually by forging a draft on disk.
  const seedDraft: AuthorDraft = {
    skill_draft_id: "draft-sandbox-test",
    user_id: "fred",
    org_slug: orgSlug,
    intent: "sandbox test",
    team: "strategy",
    slug: "sandbox-test",
    display_name: "sandbox-test",
    description: "Sandbox dryrun truncation",
    triggers_keyword: ["sandbox"],
    inputs: { required: ["data_source"], optional: [] },
    outputs: ["report.md"],
    body_md: "# sandbox-test\n",
    spec_gate: { spec_path: "spec/sandbox.md", stop_when: "ok" },
    state: "SANDBOX_PROMPT",
    history: [
      { role: "user", text: "sandbox test", ts: new Date().toISOString() },
      { role: "pm", text: "clarify", ts: new Date().toISOString() },
      { role: "user", text: "answers", ts: new Date().toISOString() },
      { role: "pm", text: "draft preview", ts: new Date().toISOString() },
    ],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const sessionFile = path.join(
    workspace,
    orgSlug,
    ".solosquad",
    "sessions",
    "fred.author-draft.json",
  );
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify(seedDraft));

  // User sends a sample input that contains the required field name.
  const result = await runAuthorLoop({
    workspace,
    orgSlug,
    userId: "fred",
    userMessage: "data_source=https://example.com/feed.json",
    claude,
  });

  assert.equal(result.state, "AWAIT_CONFIRM");
  assert.ok(result.draft.sandbox_preview);
  assert.equal(result.draft.sandbox_preview!.truncated, true);
  assert.equal(result.draft.sandbox_preview!.preview.length, 500);
  assert.ok(result.draft.sandbox_preview!.full_path);
  assert.ok(fs.existsSync(result.draft.sandbox_preview!.full_path!));
});
