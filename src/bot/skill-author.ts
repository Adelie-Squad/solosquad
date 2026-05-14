import fs from "fs";
import path from "path";
import {
  parseSkillMd,
  validateSkill,
  emitSkillMd,
  serializeFrontmatter,
  type SkillSpec,
  type SkillInputs,
} from "./skill-parser.js";
import { rebuildRoutes } from "./agent-router.js";
import {
  checkBudget,
  recordAuthorCost,
  type OnCapAction,
} from "./author-budget.js";
import { getAssetsDir, getOrgDir } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import { usdFromUsage, type CostModel, type UsageBreakdown } from "../util/cost.js";

/**
 * v0.5 §5 — Author loop entrypoint.
 *
 * Multi-turn state machine that drives a messenger conversation through the
 * five steps in §5.2-5.6: CLARIFY → DRAFT → SANDBOX_PROMPT (optional) →
 * AWAIT_CONFIRM → APPLY. Per-user, single in-flight draft, persisted at
 * `<org>/.solosquad/sessions/<user>.author-draft.json`.
 *
 * S3 stubs the real LLM behind a `ClaudeCaller` interface so unit tests
 * can drive the state machine deterministically. Production wiring happens
 * in S5 (when the goal-runner integration lands).
 *
 * Important invariant — every SKILL produced by this author loop has
 * `stateful: false` enforced before write. Validation runs after
 * serialization; if the validator rejects, the loop refuses to write and
 * surfaces the error.
 */

export type AuthorState =
  | "CLARIFY"
  | "DRAFT"
  | "SANDBOX_PROMPT"
  | "AWAIT_CONFIRM"
  | "APPLIED"
  | "ABORTED";

export interface ClarifyAnswer {
  inputs?: string;
  outputs?: string;
  cadence?: string;
}

export interface AuthorDraft {
  skill_draft_id: string;
  user_id: string;
  org_slug: string;
  intent: string;
  team: string;
  /** Working name (kebab-case slug) — used for path. */
  slug: string;
  /** Display name for SKILL.md `name` field. */
  display_name: string;
  description: string;
  triggers_keyword: string[];
  inputs: { required: string[]; optional: string[] };
  outputs: string[];
  body_md: string;
  /** Optional spec-gate config — set when `loop_mode.kind: spec-gate`. */
  spec_gate?: { spec_path: string; stop_when: string };
  /** Optional `workflow.yaml` stub if author flow elected a workflow chain. */
  workflow_yaml?: string;
  /** Optional `goal.md` body (spec-gate only). */
  goal_md?: string;
  state: AuthorState;
  /** Free-text trail of turns — diagnostics. */
  history: { role: "user" | "pm"; text: string; ts: string }[];
  /** Sandbox dry-run output, set when SANDBOX_PROMPT completes. */
  sandbox_preview?: { truncated: boolean; preview: string; full_path?: string };
  /** Last error message, if any. */
  error?: string;
  created_at: string;
  updated_at: string;
}

export interface ClaudeCallResult {
  text: string;
  usage: UsageBreakdown;
  model: CostModel;
}

export interface ClaudeCallInput {
  step: string;
  prompt: string;
  model?: CostModel;
}

/** Injection point for LLM calls. S3 uses a fake; production wires real Claude. */
export interface ClaudeCaller {
  call(input: ClaudeCallInput): Promise<ClaudeCallResult>;
}

export interface AuthorLoopOpts {
  workspace: string;
  orgSlug: string;
  userId: string;
  /** Latest user turn (single message). */
  userMessage: string;
  /** Initial intent on first turn — ignored after first call. */
  intent?: string;
  /** LLM stub injection. */
  claude: ClaudeCaller;
  /** Budget caps from workspace.yaml `author.budget`. */
  budget?: {
    perCallUsd?: number;
    dailyUsd?: number;
    weeklyUsd?: number;
    onCapAction?: OnCapAction;
  };
  /** When true (default), validates produced SKILL.md before APPLY. */
  validate?: boolean;
}

export interface AuthorLoopResult {
  state: AuthorState;
  /** Message PM should send back to the user. */
  reply: string;
  draft: AuthorDraft;
  /** Set when state === "APPLIED" — path to the new SKILL.md. */
  applied_path?: string;
}

export interface ApplyDraftInput {
  workspace: string;
  orgSlug: string;
  draft: AuthorDraft;
  /** Override default destination (for tests / manual installs). */
  destination?: string;
}

export interface ApplyDraftResult {
  skill_path: string;
  spec: SkillSpec;
  workflow_path?: string;
  goal_path?: string;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function sessionsDir(workspace: string, orgSlug: string): string {
  return path.join(getOrgDir(orgSlug, workspace), ".solosquad", "sessions");
}

function draftPath(workspace: string, orgSlug: string, userId: string): string {
  return path.join(sessionsDir(workspace, orgSlug), `${userId}.author-draft.json`);
}

export function loadDraft(
  workspace: string,
  orgSlug: string,
  userId: string,
): AuthorDraft | null {
  const file = draftPath(workspace, orgSlug, userId);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as AuthorDraft;
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(workspace: string, orgSlug: string, draft: AuthorDraft): void {
  const file = draftPath(workspace, orgSlug, draft.user_id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(draft, null, 2), "utf-8");
}

export function clearDraft(
  workspace: string,
  orgSlug: string,
  userId: string,
): void {
  const file = draftPath(workspace, orgSlug, userId);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

const SLUG_MAX_LEN = 40;

function slugify(input: string): string {
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const trimmed = ascii.slice(0, SLUG_MAX_LEN) || "untitled-skill";
  return trimmed;
}

function nowIso(): string {
  return new Date().toISOString();
}

function appendHistory(draft: AuthorDraft, role: "user" | "pm", text: string): void {
  draft.history.push({ role, text, ts: nowIso() });
  draft.updated_at = nowIso();
}

function isAffirmative(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return trimmed === "y" || trimmed === "yes" || trimmed === "확정" || trimmed === "ok";
}

function isNegative(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  return trimmed === "n" || trimmed === "no" || trimmed === "취소" || trimmed === "cancel";
}

// ---------------------------------------------------------------------------
// Run loop
// ---------------------------------------------------------------------------

export async function runAuthorLoop(opts: AuthorLoopOpts): Promise<AuthorLoopResult> {
  const { workspace, orgSlug, userId } = opts;
  let draft = loadDraft(workspace, orgSlug, userId);

  if (!draft) {
    if (!opts.intent || opts.intent.trim() === "") {
      const empty = emptyDraft(orgSlug, userId, opts.userMessage);
      empty.state = "ABORTED";
      empty.error = "no draft in flight and no intent provided";
      return {
        state: "ABORTED",
        reply: "내부 오류: 진행 중인 author 세션이 없고 intent도 제공되지 않았습니다.",
        draft: empty,
      };
    }
    draft = emptyDraft(orgSlug, userId, opts.intent);
    appendHistory(draft, "user", opts.userMessage);
  } else {
    appendHistory(draft, "user", opts.userMessage);
  }

  const onCapAction = opts.budget?.onCapAction ?? "pause";

  const budgetCheck = checkBudget({
    workspace,
    orgSlug,
    perCallUsd: opts.budget?.perCallUsd,
    dailyUsd: opts.budget?.dailyUsd,
    weeklyUsd: opts.budget?.weeklyUsd,
    onCapAction,
  });

  if (!budgetCheck.allowed) {
    draft.state = "ABORTED";
    draft.error = budgetCheck.reason;
    const msg = `Daily budget 도달 — 내일 다시 시도해주세요. (${budgetCheck.reason ?? ""})`;
    appendHistory(draft, "pm", msg);
    saveDraft(workspace, orgSlug, draft);
    return { state: "ABORTED", reply: msg, draft };
  }

  switch (draft.state) {
    case "CLARIFY":
      return await advanceClarify(opts, draft);
    case "DRAFT":
      return await advanceDraft(opts, draft);
    case "SANDBOX_PROMPT":
      return await advanceSandbox(opts, draft);
    case "AWAIT_CONFIRM":
      return await advanceConfirm(opts, draft);
    case "APPLIED":
    case "ABORTED": {
      const msg = `이전 author 세션이 ${draft.state === "APPLIED" ? "완료" : "중단"}된 상태입니다. 새 의도로 시작하려면 새 메시지를 보내주세요.`;
      return { state: draft.state, reply: msg, draft };
    }
  }
}

function emptyDraft(orgSlug: string, userId: string, intent: string): AuthorDraft {
  const ts = nowIso();
  const id = `draft-${ts.replace(/[^0-9]/g, "").slice(0, 14)}-${userId.slice(0, 6)}`;
  const baseSlug = slugify(intent);
  return {
    skill_draft_id: id,
    user_id: userId,
    org_slug: orgSlug,
    intent,
    team: "strategy",
    slug: baseSlug,
    display_name: baseSlug,
    description: intent.slice(0, 120),
    triggers_keyword: [],
    inputs: { required: [], optional: [] },
    outputs: [],
    body_md: "",
    state: "CLARIFY",
    history: [],
    created_at: ts,
    updated_at: ts,
  };
}

// ---------------------------------------------------------------------------
// CLARIFY
// ---------------------------------------------------------------------------

const CLARIFY_PROMPT = `당신은 SoloSquad의 워크플로 author입니다. 사용자가 새 SKILL을 만들고 싶어합니다.

§5.2를 따라 최대 2턴 안에 다음을 명확히 합니다:
1. 입력은 무엇인가요? (API 응답 / 수동 입력 데이터 / 다른 에이전트 출력)
2. 출력 형태는? (메신저 알림 / Markdown 리포트 / JSONL)
3. 매주/매일 자동 실행 vs 사용자 트리거?

사용자 답을 못 받으면 합리적 default를 채택하고 추후 수정 가능하다고 명시.`;

async function advanceClarify(
  opts: AuthorLoopOpts,
  draft: AuthorDraft,
): Promise<AuthorLoopResult> {
  const turns = draft.history.filter((h) => h.role === "user").length;

  // First user turn after intent — ask the 3 clarifying questions.
  if (turns <= 1) {
    const reply = clarifyQuestionMessage(draft.intent);
    const call = await opts.claude.call({
      step: "clarify-question",
      prompt: `${CLARIFY_PROMPT}\n\n사용자 의도: ${draft.intent}`,
    });
    recordCallCost(opts, draft, "clarify", call);
    appendHistory(draft, "pm", reply);
    saveDraft(opts.workspace, opts.orgSlug, draft);
    return { state: "CLARIFY", reply, draft };
  }

  // Second turn — interpret answers, move to DRAFT.
  const userAnswer = opts.userMessage;
  const call = await opts.claude.call({
    step: "clarify-interpret",
    prompt: `${CLARIFY_PROMPT}\n\n사용자 의도: ${draft.intent}\n사용자 답변: ${userAnswer}`,
  });
  recordCallCost(opts, draft, "clarify", call);

  applyClarificationDefaults(draft, userAnswer, call.text);
  draft.state = "DRAFT";
  saveDraft(opts.workspace, opts.orgSlug, draft);

  // Immediately render the draft proposal.
  return await advanceDraft(opts, draft);
}

function clarifyQuestionMessage(intent: string): string {
  return [
    `이 작업을 자동화하려고 합니다. 몇 가지만 확인할게요. (intent: "${intent}")`,
    "",
    "1. 입력은 무엇인가요? (예: API 응답 / 수동 입력 / 다른 에이전트 출력)",
    "2. 출력 형태는? (예: 메신저 알림 / Markdown 리포트 / JSONL)",
    "3. 자동 실행 (매일/매주) 인가요, 사용자가 트리거하나요?",
  ].join("\n");
}

function applyClarificationDefaults(
  draft: AuthorDraft,
  userAnswer: string,
  llmText: string,
): void {
  const lower = userAnswer.toLowerCase();
  // Heuristic — the real LLM-driven extraction lives in S5. For S3 we run a
  // deterministic fallback so unit tests can drive the loop without mocking
  // LLM-side reasoning.
  if (!draft.inputs.required.length) {
    draft.inputs.required = ["data_source"];
  }
  if (!draft.outputs.length) {
    if (lower.includes("리포트") || lower.includes("markdown") || lower.includes("report")) {
      draft.outputs = ["report.md"];
    } else if (lower.includes("jsonl")) {
      draft.outputs = ["records.jsonl"];
    } else {
      draft.outputs = ["notification.md"];
    }
  }
  if (!draft.triggers_keyword.length) {
    draft.triggers_keyword = [draft.slug.replace(/-/g, " ")];
  }
  if (draft.body_md.trim() === "") {
    draft.body_md = renderBody(draft, llmText);
  }
}

function renderBody(draft: AuthorDraft, llmHint: string): string {
  return [
    `# ${draft.display_name}`,
    "",
    `> ${draft.description}`,
    "",
    "## Process",
    "",
    "1. 입력 수집",
    "2. 처리",
    "3. 출력 생성",
    "",
    llmHint ? `## Notes\n\n${llmHint.trim()}\n` : "",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// ---------------------------------------------------------------------------
// DRAFT
// ---------------------------------------------------------------------------

async function advanceDraft(
  opts: AuthorLoopOpts,
  draft: AuthorDraft,
): Promise<AuthorLoopResult> {
  const call = await opts.claude.call({
    step: "draft",
    prompt: `Render SKILL.md draft for: ${draft.intent}`,
  });
  recordCallCost(opts, draft, "draft", call);

  draft.state = draft.spec_gate ? "SANDBOX_PROMPT" : "AWAIT_CONFIRM";
  saveDraft(opts.workspace, opts.orgSlug, draft);

  const reply = renderDraftPreview(draft);
  appendHistory(draft, "pm", reply);
  saveDraft(opts.workspace, opts.orgSlug, draft);

  return { state: draft.state, reply, draft };
}

function renderDraftPreview(draft: AuthorDraft): string {
  const skillPath = `<org>/.agents/${draft.team}/${draft.slug}/SKILL.md`;
  const spec = buildSpec(draft);
  let preview = "";
  try {
    preview = emitSkillMd(spec);
  } catch {
    preview = serializeFrontmatter(spec);
  }
  return [
    "아래로 생성하려고 합니다. 확정할까요?",
    "",
    "[SKILL.md preview]",
    preview,
    "",
    `저장 위치: ${skillPath}`,
    "",
    draft.state === "SANDBOX_PROMPT"
      ? "Dry-run sandbox를 위해 샘플 입력 1건을 보내주세요 (실제 운영에서 받을 메시지와 비슷한 형태)."
      : "승인 (y/N):",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// SANDBOX_PROMPT
// ---------------------------------------------------------------------------

const SANDBOX_TRUNCATE_CHARS = 500;

async function advanceSandbox(
  opts: AuthorLoopOpts,
  draft: AuthorDraft,
): Promise<AuthorLoopResult> {
  // User just sent a sample input. Validate against inputs.required, then
  // run the (mocked) sandbox call.
  const validation = validateSampleInput(draft.inputs, opts.userMessage);
  if (!validation.ok) {
    const reply = `샘플 입력 검증 실패 — 누락 필드: ${validation.missing.join(", ")}. 다시 보내주세요.`;
    appendHistory(draft, "pm", reply);
    saveDraft(opts.workspace, opts.orgSlug, draft);
    return { state: "SANDBOX_PROMPT", reply, draft };
  }

  const call = await opts.claude.call({
    step: "sandbox-dryrun",
    prompt: `Dry-run sandbox for ${draft.slug}. Sample input: ${opts.userMessage}`,
  });
  recordCallCost(opts, draft, "sandbox", call);

  draft.sandbox_preview = persistSandboxPreview(opts, draft, call.text);
  draft.state = "AWAIT_CONFIRM";

  const reply = [
    `Dry-run 결과 미리보기${draft.sandbox_preview.truncated ? ` (첫 ${SANDBOX_TRUNCATE_CHARS}자만 표시 — 전체: ${draft.sandbox_preview.full_path})` : ""}:`,
    "",
    draft.sandbox_preview.preview,
    "",
    "production 등록 (y/N):",
  ].join("\n");
  appendHistory(draft, "pm", reply);
  saveDraft(opts.workspace, opts.orgSlug, draft);

  return { state: "AWAIT_CONFIRM", reply, draft };
}

function validateSampleInput(
  inputs: { required: string[] },
  sample: string,
): { ok: boolean; missing: string[] } {
  if (!inputs.required || inputs.required.length === 0) {
    return { ok: true, missing: [] };
  }
  const lower = sample.toLowerCase();
  const missing: string[] = [];
  for (const field of inputs.required) {
    if (!lower.includes(field.toLowerCase())) {
      missing.push(field);
    }
  }
  return { ok: missing.length === 0, missing };
}

function persistSandboxPreview(
  opts: AuthorLoopOpts,
  draft: AuthorDraft,
  output: string,
): { truncated: boolean; preview: string; full_path?: string } {
  const normalized = normalizeLine(output);
  if (normalized.length <= SANDBOX_TRUNCATE_CHARS) {
    return { truncated: false, preview: normalized };
  }
  const draftsDir = path.join(getOrgDir(opts.orgSlug, opts.workspace), "workflows", "_drafts");
  fs.mkdirSync(draftsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fullPath = path.join(draftsDir, `${draft.slug}-dryrun-${ts}.md`);
  fs.writeFileSync(fullPath, normalized, "utf-8");
  return {
    truncated: true,
    preview: normalized.slice(0, SANDBOX_TRUNCATE_CHARS),
    full_path: fullPath,
  };
}

// ---------------------------------------------------------------------------
// AWAIT_CONFIRM
// ---------------------------------------------------------------------------

async function advanceConfirm(
  opts: AuthorLoopOpts,
  draft: AuthorDraft,
): Promise<AuthorLoopResult> {
  if (isNegative(opts.userMessage)) {
    draft.state = "ABORTED";
    const reply = "취소되었습니다. 변경사항은 적용되지 않았습니다.";
    appendHistory(draft, "pm", reply);
    saveDraft(opts.workspace, opts.orgSlug, draft);
    return { state: "ABORTED", reply, draft };
  }

  if (!isAffirmative(opts.userMessage)) {
    const reply = "확인이 필요합니다 — `y` 또는 `n`으로 답해주세요.";
    appendHistory(draft, "pm", reply);
    saveDraft(opts.workspace, opts.orgSlug, draft);
    return { state: "AWAIT_CONFIRM", reply, draft };
  }

  let applied: ApplyDraftResult;
  try {
    applied = applyDraft({
      workspace: opts.workspace,
      orgSlug: opts.orgSlug,
      draft,
    });
  } catch (e) {
    draft.state = "ABORTED";
    draft.error = (e as Error).message;
    const reply = `저장 실패: ${draft.error}`;
    appendHistory(draft, "pm", reply);
    saveDraft(opts.workspace, opts.orgSlug, draft);
    return { state: "ABORTED", reply, draft };
  }

  draft.state = "APPLIED";
  const reply = [
    "저장 완료. 라우터를 reload 했습니다.",
    `- SKILL.md: ${applied.skill_path}`,
    applied.workflow_path ? `- workflow.yaml: ${applied.workflow_path}` : "",
    applied.goal_path ? `- goal.md: ${applied.goal_path}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  appendHistory(draft, "pm", reply);
  saveDraft(opts.workspace, opts.orgSlug, draft);

  return {
    state: "APPLIED",
    reply,
    draft,
    applied_path: applied.skill_path,
  };
}

// ---------------------------------------------------------------------------
// applyDraft — deterministic file writer
// ---------------------------------------------------------------------------

export function applyDraft(input: ApplyDraftInput): ApplyDraftResult {
  const { workspace, orgSlug, draft } = input;

  // v0.5 §12 — stateful: false is enforced. Build spec, then validate, then write.
  const spec = buildSpec(draft);
  const validation = validateSkill(spec);
  if (!validation.ok) {
    const summary = validation.errors
      .map((e) => `${e.code}${e.field ? ` (${e.field})` : ""}: ${e.message}`)
      .join("; ");
    throw new Error(`SKILL.md validation failed — ${summary}`);
  }

  const skillBase =
    input.destination ??
    path.join(getOrgDir(orgSlug, workspace), ".agents", draft.team, draft.slug);
  fs.mkdirSync(skillBase, { recursive: true });
  const skillPath = path.join(skillBase, "SKILL.md");

  const body = ensureBodyTrailingNewline(spec.body || renderBody(draft, ""));
  spec.body = body;
  const content = emitSkillMd(spec);
  atomicWrite(skillPath, content);

  let workflow_path: string | undefined;
  let goal_path: string | undefined;

  if (draft.workflow_yaml) {
    workflow_path = path.join(skillBase, "workflow.yaml");
    atomicWrite(workflow_path, draft.workflow_yaml);
  }

  // v0.5 §3 — spec-gate SKILLs also compile to a goal.md so v0.4's
  // goal-runner can pick them up. Stored at `<org>/goals/<goal-id>/goal.md`
  // (where v0.4's `solosquad goal run <id>` looks) — not co-located with
  // the SKILL.
  if (draft.spec_gate) {
    const goalId = goalIdForDraft(draft);
    const goalDir = path.join(getOrgDir(orgSlug, workspace), "goals", goalId);
    fs.mkdirSync(goalDir, { recursive: true });
    goal_path = path.join(goalDir, "goal.md");
    const content = draft.goal_md ?? renderGoalFromSkill(draft, orgSlug);
    atomicWrite(goal_path, content);
  }

  rebuildRoutes({ workspace_root: workspace, org: orgSlug });

  // Re-parse from disk to return a clean SkillSpec backed by what we wrote.
  const reparsed = parseSkillMd(fs.readFileSync(skillPath, "utf-8"), skillPath);
  return { skill_path: skillPath, spec: reparsed, workflow_path, goal_path };
}

function ensureBodyTrailingNewline(body: string): string {
  if (body.endsWith("\n")) return body;
  return body + "\n";
}

function atomicWrite(target: string, content: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, target);
}

// ---------------------------------------------------------------------------
// Goal.md compilation (spec-gate) — v0.5 §3
// ---------------------------------------------------------------------------

/**
 * Stable goal-id derived from the SKILL slug. The author loop currently emits
 * one goal.md per spec-gate SKILL, so we tie the id to the slug; a future
 * extension may support multiple goals per SKILL via an explicit field.
 */
function goalIdForDraft(draft: AuthorDraft): string {
  return draft.slug;
}

/**
 * Render `<org>/goals/<goal-id>/goal.md` from the bundled template.
 *
 * Placeholders: `{goal_id}` `{org_slug}` `{title}` `{spec_path}` `{stop_when}`
 * `{pipeline}` (single-step pipeline calling the new SKILL).
 *
 * The output must satisfy `src/engine/goal-parser.ts` so that
 * `solosquad goal run <goal-id>` succeeds on a workspace where the new SKILL
 * has been registered.
 */
function renderGoalFromSkill(draft: AuthorDraft, orgSlug: string): string {
  if (!draft.spec_gate) {
    throw new Error("renderGoalFromSkill called on a non-spec-gate draft");
  }
  const templatePath = path.join(getAssetsDir(), "templates", "goal-from-skill.md");
  let template: string;
  try {
    template = fs.readFileSync(templatePath, "utf-8");
  } catch (e) {
    throw new Error(
      `Cannot read goal-from-skill template at ${templatePath}: ${(e as Error).message}`,
    );
  }
  const goalId = goalIdForDraft(draft);
  // The pipeline reference must match goal-parser's `<team>/<agent>` form.
  // `draft.team` and `draft.slug` are both kebab-case per slugify().
  const pipeline = `${draft.team}/${draft.slug}: ${draft.intent.trim()}`;
  const stopWhen = draft.spec_gate.stop_when || "spec_gate_pass reaches 1.0";
  return template
    .replace(/\{goal_id\}/g, goalId)
    .replace(/\{org_slug\}/g, orgSlug)
    .replace(/\{title\}/g, draft.display_name)
    .replace(/\{spec_path\}/g, draft.spec_gate.spec_path)
    .replace(/\{stop_when\}/g, stopWhen)
    .replace(/\{pipeline\}/g, pipeline);
}

function buildSpec(draft: AuthorDraft): SkillSpec {
  const triggers: SkillSpec["triggers"] = { explicit: true };
  if (draft.triggers_keyword.length > 0) {
    triggers.keyword = draft.triggers_keyword;
  }
  const inputs: SkillInputs | undefined =
    draft.inputs.required.length > 0 || draft.inputs.optional.length > 0
      ? {
          required: draft.inputs.required.length > 0 ? draft.inputs.required : undefined,
          optional: draft.inputs.optional.length > 0 ? draft.inputs.optional : undefined,
        }
      : undefined;

  const spec: SkillSpec = {
    name: draft.display_name,
    description: draft.description,
    team: draft.team,
    stateful: false,
    triggers,
    inputs,
    outputs: draft.outputs.length > 0 ? draft.outputs : undefined,
    scope: "agent",
    confidence: 1.0,
    source: `messenger-author-${draft.skill_draft_id}`,
    loop_mode: draft.spec_gate
      ? { kind: "spec-gate", spec_path: draft.spec_gate.spec_path, stop_when: draft.spec_gate.stop_when }
      : undefined,
    extra: {},
    raw_frontmatter: "",
    body: draft.body_md,
  };
  return spec;
}

// ---------------------------------------------------------------------------
// Cost recording helper
// ---------------------------------------------------------------------------

function recordCallCost(
  opts: AuthorLoopOpts,
  draft: AuthorDraft,
  step: string,
  call: ClaudeCallResult,
): void {
  const usd = usdFromUsage(call.usage, call.model);
  recordAuthorCost({
    workspace: opts.workspace,
    orgSlug: opts.orgSlug,
    skillDraftId: draft.skill_draft_id,
    step,
    usd,
    model: call.model,
  });
}
