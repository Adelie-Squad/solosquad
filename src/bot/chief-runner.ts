import {
  NOT_LOGGED_IN_PATTERN,
  SESSION_NOT_FOUND_PATTERN,
  singleUserMessage,
  type ClaudeProcessFactory,
  type StreamJsonOutputLine,
} from "./claude-process.js";
import { SessionStore } from "./session-store.js";
import {
  type EventSink,
  type AnyEvent,
  nowIso,
} from "./events.js";
import { parseSpawnMarkers } from "./spawn-prompt-markers.js";
import { parseFocusMarker, stripFocusMarkers } from "./focus-markers.js";
import {
  assembleSpawnContext,
  type AssembledContext,
} from "./spawn-assembler.js";
import { checkAgentBudget, type CheckAgentBudgetResult } from "./agent-budget.js";
import { loadWorkspaceYaml, loadOrgYaml } from "../util/config.js";
import { loadAgentProfile } from "../util/agent-profile.js";
import {
  emit as emitChiefStage,
  type ChiefStage,
} from "../util/chief-stage-events.js";

/**
 * Emit a Chief 6+1 stage event (v1.1 §5.2) without ever throwing — a
 * jsonl-write failure must not poison the user turn. orgRoot is the same
 * directory chief-runner operates in (the org cwd), so all artifacts
 * land under <org>/memory/chief-stage-events.jsonl.
 */
/**
 * v1.2.4 §B.2 — Build the Chief identity hint injected into the system
 * prompt. Reads `<org>/.org.yaml.chief_name`; falls back silently to an
 * empty string when the field is unset (runtime label still defaults to
 * "Chief" in the messenger surface). Pure file read — no LLM contact.
 *
 * Format keeps the prompt small + cache-friendly (same org → same
 * string → same cache hit across turns).
 */
function resolveChiefIdentityHint(orgCwd: string): string {
  try {
    const org = loadOrgYaml(orgCwd);
    const name = org?.chief_name?.trim();
    if (!org || !name) return "";
    return (
      `\n\n[identity] You are **${name}** — the org-level Chief / supervisor for "${org.name}". Refer to yourself by this name when you sign off, narrate progress, or describe your role. The user picked it specifically; honor it.`
    );
  } catch {
    return "";
  }
}

/**
 * v1.2.7 §A.6 — collect absolute paths of every repo registered under
 * `<org>/repositories/*.yaml` so the bot's `claude --print` spawn can
 * pass them as `--add-dir <path1> <path2> ...`. Without this, Chief
 * operating from cwd=<org> reports "no access" to repos that live at
 * paths like `C:\Dev\<repo>` (registered via the v1.0+ path-reference
 * model — repos are NOT moved into the workspace).
 *
 * Pure file read. Best-effort: unparseable yamls are skipped (the
 * Chief turn must not abort on user-yaml shape drift).
 */
/**
 * v1.2.7 §A.7 — derive a sensible default location for *new* repo
 * clones requested via Chief conversation. Strategy: pick the most
 * common parent dir of the user's already-registered repos.
 * Returns "" when no repos are registered yet (Chief will ask the user).
 *
 * Why deterministic injection: asking Chief to compute this every turn
 * is unreliable + token-expensive. The system prompt hint is constant
 * across turns for a given org → same Claude cache hit.
 */
function resolveRepoCloneDefault(orgCwd: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const paths = collectRegisteredRepoPaths(orgCwd);
    if (paths.length === 0) return "";

    const counts = new Map<string, number>();
    for (const p of paths) {
      const parent = path.dirname(p);
      counts.set(parent, (counts.get(parent) ?? 0) + 1);
    }
    let bestDir = "";
    let bestCount = 0;
    for (const [d, c] of counts) {
      if (c > bestCount) {
        bestDir = d;
        bestCount = c;
      }
    }
    return bestDir;
  } catch {
    return "";
  }
}

function collectRegisteredRepoPaths(orgCwd: string): string[] {
  const out: string[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const yamlLib = require("js-yaml") as typeof import("js-yaml");
    const reposDir = path.join(orgCwd, "repositories");
    if (!fs.existsSync(reposDir)) return out;

    for (const entry of fs.readdirSync(reposDir)) {
      if (!entry.endsWith(".yaml")) continue;
      try {
        const body = fs.readFileSync(path.join(reposDir, entry), "utf-8");
        const doc = yamlLib.load(body) as { path?: string } | null;
        const p = doc?.path;
        if (typeof p === "string" && p.trim().length > 0) {
          const resolved = path.resolve(p);
          if (fs.existsSync(resolved)) out.push(resolved);
        }
      } catch {
        /* skip unparseable */
      }
    }
  } catch {
    /* skip on any infrastructure failure */
  }
  return out;
}

function safeEmitStage(
  orgRoot: string,
  turnId: string,
  stage: ChiefStage,
  detail?: string,
  extra?: { dispatched?: string[]; skills_used?: string[] }
): void {
  try {
    emitChiefStage(
      { orgRoot },
      {
        turn_id: turnId,
        stage,
        detail,
        dispatched: extra?.dispatched,
        skills_used: extra?.skills_used,
      }
    );
  } catch {
    // Diagnostic-only — never gate a user turn on jsonl I/O.
  }
}

/**
 * v0.3.0 — Chief session driver (renamed from pm-runner in v1.1).
 *
 * Wraps the long-lived Claude Code session that talks to the user. Per
 * v1.1 PRD §5 (Chief Sub-System), this driver hosts the Chief — the
 * org-level supervisor — not PM. PM is a separate workspace-bundle main
 * bot (`agents/main/pm/`) that Chief dispatches to via the Task tool for
 * autonomous deep work; PM never talks to the user directly.
 *
 * Event names ("pm.message_in", "pm.rate_limit", "pm.error",
 * "pm.message_out") are intentionally retained for backward-compat with
 * existing archive.sqlite consumers and dashboards. Treat the "pm." prefix
 * as the legacy *session-driver* namespace, not as the v1.1 "PM" agent.
 *
 * The flow (per docs/plan/v0.3-pm-mode-orchestration.md §4.2):
 *
 *   handleUserMessage(call)
 *     1. Acquire session-id mutex (per PoC #1 §1.5 — concurrent --resume
 *        creates interleaved jsonl that garbles future resumes)
 *     2. SessionStore.ensure -> sessionId + fresh? flag
 *     3. Emit pm.message_in
 *     4. claude.invokeStreaming({ sessionId, resume: !fresh, ... })
 *     5. Loop stream-json lines:
 *          - assistant text       -> accumulate, forward to messenger
 *          - task_started         -> spawn.start event
 *          - task_notification    -> spawn.complete (status=completed)
 *                                    or spawn.fail (status=failed)
 *          - rate_limit_event !=allowed -> pm.rate_limit
 *          - result               -> final cost/text capture
 *     6. Exit/stderr branch:
 *          - "Not logged in"      -> AuthExpiredError
 *          - "No conversation found" -> rotate session-id, retry once
 *          - else exit!=0         -> pm.error
 *     7. Emit pm.message_out
 *     8. SessionStore.recordTurn (cost accumulate)
 *     9. Release mutex
 */

export interface ChiefRunnerDeps {
  claude: ClaudeProcessFactory;
  sessions: SessionStore;
  events: (orgSlug: string, userId: string) => EventSink;
  maxBudgetUsd?: number;
  timeoutMs?: number;
}

export interface ChiefCall {
  userId: string;
  orgSlug: string;
  orgCwd: string;
  userText: string;
}

/**
 * v1.2 §6.2 — TRIAGE classifier output. Chief is instructed (per
 * `agents/main/chief/SKILL.md`) to emit `[kind:<value>]` as the first
 * line of every reply. The runner strips the marker and exposes the
 * parsed value so messenger adapters can route accordingly.
 *
 * `chat` (default) → command channel flat reply.
 * `workflow` / `schedule` / `goal` → works-handle task card + thread.
 */
export type ChiefKind = "chat" | "workflow" | "schedule" | "goal";

export interface ChiefReply {
  text: string;
  /** v1.2 §6.2 — parsed from `[kind:...]` marker; defaults to "chat". */
  kind: ChiefKind;
  /**
   * v1.2 §8 — correlation id for the turn. Used by messenger adapters
   * to fetch matching entries from `<org>/memory/chief-stage-events.jsonl`
   * for thread narration (DISPATCH / AWAIT / skills_used).
   */
  turnId: string;
  costUsd: number;
  durationMs: number;
  sessionRotated: boolean;
  rateLimited: boolean;
  spawnCount: number;
}

const KIND_MARKER_RE = /^\s*\[kind:(chat|workflow|schedule|goal)\]\s*\n?/i;
const USER_TEXT_KIND_HEURISTICS: Array<[RegExp, ChiefKind]> = [
  [/^\s*\/?(workflow|워크플로|워크플로우)\b/i, "workflow"],
  [/^\s*\/?(schedule|스케줄|매일|매주|매월)\b/i, "schedule"],
  [/^\s*\/?(goal|목표)\b/i, "goal"],
];

/**
 * Heuristic classifier used when Chief's reply has no `[kind:...]`
 * marker (older Chief templates, or chief-stage-events log replay). The
 * primary signal is still the Chief-emitted marker — this is just a
 * safety net so v1.2 routing works for explicit user requests even
 * without Chief retraining.
 */
function classifyByUserText(userText: string): ChiefKind {
  for (const [re, kind] of USER_TEXT_KIND_HEURISTICS) {
    if (re.test(userText)) return kind;
  }
  return "chat";
}

/**
 * Extract the kind marker from a reply, returning the parsed kind plus
 * the reply text with the marker stripped. When no marker is present,
 * the text is returned unchanged and kind is null (caller falls back to
 * `classifyByUserText`).
 */
export function parseKindMarker(reply: string): {
  kind: ChiefKind | null;
  text: string;
} {
  const m = reply.match(KIND_MARKER_RE);
  if (!m) return { kind: null, text: reply };
  return {
    kind: m[1].toLowerCase() as ChiefKind,
    text: reply.slice(m[0].length),
  };
}

export class AuthExpiredError extends Error {
  constructor() {
    super("Claude Code reports not logged in. Run `claude login` and retry.");
    this.name = "AuthExpiredError";
  }
}

/**
 * Per-session-id mutex. Serializes concurrent invocations on the same key so
 * the underlying jsonl transcript stays coherent. Queue depth cap so a runaway
 * user can't pile up requests indefinitely.
 */
export class SessionMutex {
  private locks = new Map<string, Promise<void>>();
  private queued = new Map<string, number>();

  constructor(private readonly maxQueueDepth: number = 4) {}

  async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const queued = this.queued.get(key) ?? 0;
    if (queued >= this.maxQueueDepth) {
      throw new Error(
        `Too many in-flight requests for session ${key} (queue depth ${queued}). Please wait.`
      );
    }
    this.queued.set(key, queued + 1);
    const prior = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    this.locks.set(key, prior.then(() => next));
    await prior;
    try {
      return await fn();
    } finally {
      release();
      const newQueued = (this.queued.get(key) ?? 1) - 1;
      if (newQueued <= 0) {
        this.queued.delete(key);
        Promise.resolve().then(() => {
          if (this.locks.get(key) === prior.then(() => next)) {
            this.locks.delete(key);
          }
        });
      } else {
        this.queued.set(key, newQueued);
      }
    }
  }
}

export class ChiefRunner {
  private readonly mutex = new SessionMutex();

  constructor(private readonly deps: ChiefRunnerDeps) {}

  async handleUserMessage(call: ChiefCall): Promise<ChiefReply> {
    const key = `${call.orgSlug}:${call.userId}`;
    return this.mutex.acquire(key, () => this.runTurn(call));
  }

  async resetSession(
    orgSlug: string,
    userId: string,
    reason = "user-requested"
  ): Promise<{ previous: string | null; next: string }> {
    return this.deps.sessions.rotate(orgSlug, userId, reason);
  }

  private async runTurn(call: ChiefCall): Promise<ChiefReply> {
    const sink = this.deps.events(call.orgSlug, call.userId);
    const startedAt = Date.now();
    // v1.1 §5.2 — Chief 6+1 stage machine. Each turn gets a stable id so
    // RETROSPECT/skill-refinement can replay it later. The turn_id is the
    // start timestamp + user id; uniqueness inside an org is sufficient.
    const turnId = `turn-${startedAt}-${call.userId}`;
    safeEmitStage(call.orgCwd, turnId, "TRIAGE", "user_message_in");

    sink.append({
      ts: nowIso(),
      kind: "pm.message_in",
      text: call.userText,
      userId: call.userId,
    });

    const result = await this.invokeWithSessionRecovery(
      call,
      sink,
      false,
      turnId
    );

    // After Claude finishes its tool loop and emits a final result, the
    // turn enters SYNTHESIZE (merging any task outputs into the assistant
    // reply) and then DECIDE (the reply itself is the decision). We emit
    // both unconditionally — even a discussion-only turn passes through
    // both, just with a tiny SYNTHESIZE.
    safeEmitStage(call.orgCwd, turnId, "SYNTHESIZE", `spawns=${result.spawnCount}`);
    safeEmitStage(
      call.orgCwd,
      turnId,
      "DECIDE",
      result.rateLimited ? "rate_limited" : "ok"
    );

    const durationMs = Date.now() - startedAt;
    this.deps.sessions.recordTurn(call.orgSlug, call.userId, result.costUsd);

    sink.append({
      ts: nowIso(),
      kind: "pm.message_out",
      text: result.text,
      costUsd: result.costUsd,
      durationMs,
      userId: call.userId,
    });

    // RETROSPECT closes the turn. Future work (chief retrospective skill)
    // reads chief-stage-events.jsonl per turn_id to learn from the cycle.
    safeEmitStage(call.orgCwd, turnId, "RETROSPECT", `duration_ms=${durationMs}`);

    // v1.2 §6.2 — strip the `[kind:...]` marker before handing back to
    // the messenger. Fallback to user-text heuristics when Chief didn't
    // emit the marker (older Chief templates).
    const parsed = parseKindMarker(result.text);
    const kind: ChiefKind = parsed.kind ?? classifyByUserText(call.userText);

    return {
      text: parsed.text,
      kind,
      turnId,
      costUsd: result.costUsd,
      durationMs,
      sessionRotated: result.sessionRotated,
      rateLimited: result.rateLimited,
      spawnCount: result.spawnCount,
    };
  }

  private async invokeWithSessionRecovery(
    call: ChiefCall,
    sink: EventSink,
    rotatedAlready: boolean,
    turnId?: string
  ): Promise<InternalTurnResult> {
    const { record, fresh } = this.deps.sessions.ensure(call.orgSlug, call.userId);
    const sessionId = record.sessionId;
    // After a rotation, the new session-id was just minted by SessionStore.rotate
    // and has never been used with claude — treat it as fresh so we pass
    // --session-id <uuid> instead of --resume <uuid>.
    const useResume = !fresh && !rotatedAlready;

    // v0.3.0: tell PM its currently-focused workflow (if any). The append
    // text is cache-friendly — same workflow id ⇒ same prompt ⇒ cache hit.
    const focusHint = record.activeWorkflowId
      ? `\n\n[ambient] Your currently-focused workflow is \`${record.activeWorkflowId}\`. If you switch focus, include \`[focus:<new-wf-id>]\` (or \`[focus:none]\`) in your reply.`
      : "";

    // v1.2.4 §B.2 — inject the org's Chief name into the system prompt
    // so Claude signs/refers to itself with the user-chosen identity
    // (e.g. "Hermes" instead of falling back to the org slug or
    // "Claude"). Pure read from <org>/.org.yaml — cache-friendly: same
    // org → same prompt → same cache hit.
    const chiefIdentity = resolveChiefIdentityHint(call.orgCwd);

    // v1.2.7 §A.6 — pass every registered repo's absolute path via
    // `--add-dir` so Chief can read/write files in repos that live
    // outside the org cwd (the v1.0+ path-reference model never moves
    // repos into the workspace tree). Without this, Chief reports
    // "no access" to repos and instructs the user to run `/add-dir`
    // manually — a slash command the bot can't invoke for itself.
    const addDirs = collectRegisteredRepoPaths(call.orgCwd);

    // v1.2.7 §A.7 — when the user asks Chief to clone a new repo, the
    // sensible default location is *next to existing registered repos*
    // (same parent dir). Inject the most-common parent of registered
    // repo paths so Chief can default cleanly without computing this
    // itself every turn. Empty string when no repos registered yet —
    // Chief will then ask the user where to clone.
    const cloneDefault = resolveRepoCloneDefault(call.orgCwd);
    const cloneHint = cloneDefault
      ? `\n\n[repo-clone-defaults] When the user asks you to clone a new git repo, default the target path to \`${cloneDefault}\\<repo-name>\` (the directory where existing registered repos already live). Recipe:\n  1. \`git clone <url> ${cloneDefault}\\<repo-name>\` (via Bash). The Bash tool can clone to that path without explicit \`--add-dir\` — only Read/Edit/Write tools are path-restricted.\n  2. \`solosquad add repo ${cloneDefault}\\<repo-name>\` so the next turn picks up the path in --add-dir.\n  3. Tell the user the new repo will be accessible *starting next turn* (current turn's spawn args are already fixed). If the user wants a different location, ask them and use their choice instead.`
      : "";

    const stream = this.deps.claude.invokeStreaming({
      sessionId,
      cwd: call.orgCwd,
      resume: useResume,
      input: singleUserMessage(call.userText),
      excludeDynamicSystemPromptSections: true,
      includePartialMessages: true,
      maxBudgetUsd: this.deps.maxBudgetUsd ?? 5,
      timeoutMs: this.deps.timeoutMs ?? 300_000,
      appendSystemPrompt:
        (chiefIdentity + focusHint + cloneHint) || undefined,
      addDirs: addDirs.length > 0 ? addDirs : undefined,
    });

    let costUsd = 0;
    let rateLimited = false;
    let spawnCount = 0;
    let lastResultText = "";
    const collectedAssistantText: string[] = [];

    let decomposeEmitted = false;
    for await (const line of stream.lines) {
      this.processLine(line, sink, {
        onAssistantText: (text) => collectedAssistantText.push(text),
        onSpawn: () => {
          spawnCount++;
          if (turnId) {
            // First spawn implies Chief has DECOMPOSEd the request. Emit
            // once, then a DISPATCH per spawn so downstream count is
            // exactly the spawn fan-out.
            if (!decomposeEmitted) {
              safeEmitStage(call.orgCwd, turnId, "DECOMPOSE", "first_spawn");
              decomposeEmitted = true;
            }
            safeEmitStage(call.orgCwd, turnId, "DISPATCH", `spawn=${spawnCount}`);
          }
        },
        onRateLimit: () => (rateLimited = true),
        onResult: (text, cost) => {
          lastResultText = text;
          costUsd = cost;
        },
        userId: call.userId,
      });
    }
    // If at least one spawn happened, the runner spent time in AWAIT
    // between the last DISPATCH and the stream's final result. Emit AWAIT
    // once so the trace shows the full TRIAGE→…→DECIDE arc rather than a
    // gap where AWAIT belongs.
    if (turnId && spawnCount > 0) {
      safeEmitStage(call.orgCwd, turnId, "AWAIT", `spawn_count=${spawnCount}`);
    }

    const exit = await stream.done;

    if (NOT_LOGGED_IN_PATTERN.test(exit.unparsedStdout)) {
      sink.append({
        ts: nowIso(),
        kind: "pm.auth_expired",
        userId: call.userId,
      });
      throw new AuthExpiredError();
    }

    if (exit.exitCode !== 0 && SESSION_NOT_FOUND_PATTERN.test(exit.stderr)) {
      if (rotatedAlready) {
        sink.append({
          ts: nowIso(),
          kind: "pm.error",
          reason: "session-lost-after-rotate",
          exitCode: exit.exitCode,
          stderrTail: exit.stderr.slice(-200),
          userId: call.userId,
        });
        throw new Error(`Session lost twice in a row: ${exit.stderr.slice(-200)}`);
      }
      const { next } = this.deps.sessions.rotate(
        call.orgSlug,
        call.userId,
        "session-not-found"
      );
      sink.append({
        ts: nowIso(),
        kind: "pm.session_lost",
        oldSessionId: sessionId,
        newSessionId: next,
        userId: call.userId,
      });
      const retry = await this.invokeWithSessionRecovery(call, sink, true, turnId);
      return { ...retry, sessionRotated: true };
    }

    if (exit.exitCode !== 0 && exit.exitCode !== null) {
      sink.append({
        ts: nowIso(),
        kind: "pm.error",
        reason: "non-zero-exit",
        exitCode: exit.exitCode,
        signal: exit.signal,
        stderrTail: exit.stderr.slice(-200),
        userId: call.userId,
      });
      throw new Error(
        `Claude Code exited with code ${exit.exitCode}: ${exit.stderr.slice(-200)}`
      );
    }

    const rawText = lastResultText || collectedAssistantText.join("");

    // v0.3.0: apply any [focus:<wf-id>] marker, then strip from user-facing reply.
    const focusUpdate = parseFocusMarker(rawText);
    if (focusUpdate) {
      this.deps.sessions.setActiveWorkflow(
        call.orgSlug,
        call.userId,
        focusUpdate.workflowId ?? undefined
      );
    }
    const text = focusUpdate ? stripFocusMarkers(rawText) : rawText;

    return {
      text,
      costUsd,
      rateLimited,
      spawnCount,
      sessionRotated: false,
    };
  }

  private processLine(
    line: StreamJsonOutputLine,
    sink: EventSink,
    handlers: {
      onAssistantText: (text: string) => void;
      onSpawn: () => void;
      onRateLimit: () => void;
      onResult: (text: string, cost: number) => void;
      userId: string;
    }
  ): void {
    if (line.type === "assistant" && (line as Record<string, unknown>).message) {
      const msg = (line as { message: { content?: Array<{ type: string; text?: string }> } }).message;
      for (const block of msg.content ?? []) {
        if (block.type === "text" && typeof block.text === "string") {
          handlers.onAssistantText(block.text);
        }
      }
      return;
    }

    if (line.type === "system" && (line as { subtype?: string }).subtype === "task_started") {
      const l = line as unknown as {
        task_id: string;
        tool_use_id: string;
        description?: string;
        prompt?: string;
      };
      handlers.onSpawn();
      const markers = parseSpawnMarkers(l.prompt ?? "");
      sink.append({
        ts: nowIso(),
        kind: "spawn.start",
        taskId: l.task_id,
        toolUseId: l.tool_use_id,
        agent: l.description ?? "(unknown)",
        description: l.description ?? "",
        stageId: markers.stageId,
        workflowId: markers.workflowId,
      });
      return;
    }

    if (line.type === "system" && (line as { subtype?: string }).subtype === "task_notification") {
      const l = line as unknown as {
        task_id: string;
        tool_use_id: string;
        status: "completed" | "failed";
        usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number };
      };
      const usage = l.usage ?? {};
      if (l.status === "completed") {
        sink.append({
          ts: nowIso(),
          kind: "spawn.complete",
          taskId: l.task_id,
          toolUseId: l.tool_use_id,
          totalTokens: usage.total_tokens,
          toolUses: usage.tool_uses,
          durationMs: usage.duration_ms,
        });
      } else {
        sink.append({
          ts: nowIso(),
          kind: "spawn.fail",
          taskId: l.task_id,
          toolUseId: l.tool_use_id,
          status: l.status,
        });
      }
      return;
    }

    if (line.type === "rate_limit_event") {
      const info = (line as { rate_limit_info: { status?: string; resetsAt?: number; rateLimitType?: string } }).rate_limit_info;
      if (info.status && info.status !== "allowed") {
        handlers.onRateLimit();
        sink.append({
          ts: nowIso(),
          kind: "pm.rate_limit",
          resetsAt: info.resetsAt,
          rateLimitType: info.rateLimitType,
          userId: handlers.userId,
        });
      }
      return;
    }

    if (line.type === "result") {
      const l = line as { result?: string; total_cost_usd?: number };
      handlers.onResult(String(l.result ?? ""), Number(l.total_cost_usd ?? 0));
      return;
    }
  }
}

interface InternalTurnResult {
  text: string;
  costUsd: number;
  rateLimited: boolean;
  spawnCount: number;
  sessionRotated: boolean;
}

// ---------- helpers exported for tests + caller convenience ----------

export function ifEvent<K extends AnyEvent["kind"]>(
  events: AnyEvent[],
  kind: K
): Array<Extract<AnyEvent, { kind: K }>> {
  return events.filter((e): e is Extract<AnyEvent, { kind: K }> => e.kind === kind);
}

// ---------------------------------------------------------------------------
// v0.6 §2.2 — spawn preflight helpers.
//
// The PM session itself runs inside Claude Code, and the `Task` tool that
// launches specialists is internal to that process — chief-runner cannot
// intercept individual Task calls from the host side. These helpers expose
// the 8-layer assembly + agent-budget check as *pure functions* so:
//   - bot-layer adapters can do budget gating before relaying a user message
//     that would obviously trigger a spawn (e.g. routine-level pre-flight),
//   - the messenger reply layer can append the assembled context to the
//     PM's `--append-system-prompt`,
//   - tests can verify the 8-layer + budget logic without an end-to-end
//     Claude Code invocation.
//
// Aggregator returns Layer list only; Task-prompt concatenation is owned by
// the caller because spawn injection surfaces differ (cwd-adjacent file,
// `--append-system-prompt`, Task tool prompt body).
// ---------------------------------------------------------------------------

export interface SpawnPreflightInput {
  workspace: string;
  orgSlug: string;
  agentRef: { team: string; name: string };
  repoSlug?: string;
  workflowId?: string;
  /** User-facing text / task description — drives keyword selection. */
  query?: string;
}

export interface SpawnPreflightResult {
  budget: CheckAgentBudgetResult;
  context: AssembledContext;
  /** True when budget refuses the spawn (action=pause + exceeded). */
  refused: boolean;
  /** Korean-language user-facing message — empty when allowed. */
  userMessage: string;
}

/**
 * Pre-flight check: load the agent profile once, then return both the budget
 * verdict and the assembled 8-layer context. Cheap to call (single yaml load
 * + a directory walk).
 */
export function preflightSpawn(input: SpawnPreflightInput): SpawnPreflightResult {
  const workspaceYaml = loadWorkspaceYaml(input.workspace);
  const profile = loadAgentProfile({
    workspace: input.workspace,
    orgSlug: input.orgSlug,
  });

  const budget = checkAgentBudget({
    workspace: input.workspace,
    orgSlug: input.orgSlug,
    agentName: input.agentRef.name,
    agentProfile: profile,
  });

  const context = assembleSpawnContext({
    workspace: input.workspace,
    orgSlug: input.orgSlug,
    agentRef: input.agentRef,
    repoSlug: input.repoSlug,
    workflowId: input.workflowId,
    query: input.query,
    workspaceYaml,
    agentProfile: profile,
  });

  const refused = !budget.allowed;
  const userMessage = refused
    ? `${input.agentRef.name} 호출이 일시 차단되었습니다. ${budget.reason ?? "Daily budget 도달 — 내일 다시 시도해주세요."}`
    : "";

  return { budget, context, refused, userMessage };
}
