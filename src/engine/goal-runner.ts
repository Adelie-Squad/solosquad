import path from "path";
import { randomUUID } from "crypto";
import fs from "fs";
import {
  type ClaudeProcessFactory,
  singleUserMessage,
  type StreamJsonOutputLine,
} from "../bot/claude-process.js";
import {
  FileEventSink,
  pmEventsPath,
  workflowEventsPath,
  nowIso,
  type AnyEvent,
} from "../bot/events.js";
import { SessionStore } from "../bot/session-store.js";
import { getOrgDir } from "../util/paths.js";
import type { GoalSpec } from "./goal-parser.js";
import { loadAgentsMd } from "./agents-md-loader.js";
import {
  newCostTracker,
  preflightInputGuard,
  recordCycleCost,
  resolvePaths,
  runtimeGuard,
  type CostTracker,
} from "./guards.js";
import {
  evaluateCycle,
  takePreCycleSnapshot,
  type MetricMeasurer,
} from "./evaluator.js";
import {
  goalDir,
  summarizeRun,
  type GoalRunSummary,
} from "./tracker.js";

/**
 * v0.4 — goal-runner.
 *
 * Per docs/plan/v0.4-autonomous-engine.md §3 + §8.
 *
 * Drives one autonomous goal run end-to-end:
 *   1. Load goal.md + AGENTS.md, resolve paths, preflight Input guard
 *   2. Open a dedicated background PM session (bg-<goal-id>-<run-ts>)
 *   3. Cycle loop:
 *      a) pre-cycle git-snapshot commit
 *      b) PM executes the pipeline via Task tool (each stage = one Task call)
 *      c) evaluator measures + keep/discard
 *      d) tracker appends results.tsv + _best.json
 *      e) Runtime guard checks budget/discard streak → continue or stop
 *      f) CONFIRMING state machine (2 consecutive keeps → CONVERGED → ship)
 *   4. Final summary written to <goal-id>/_last-run.md (morning-brief reads)
 *
 * The runner does NOT post to the messenger directly (Output guard). Results
 * surface via morning-brief routine on the next 08:00 brief.
 */

export type GoalRunState = "RUNNING" | "CONFIRMING1" | "CONFIRMING2" | "CONVERGED" | "STOPPED";

export interface GoalRunnerDeps {
  workspace: string;
  claude: ClaudeProcessFactory;
  sessions: SessionStore;
  measurer: MetricMeasurer;
  /** Hard timeout per Claude invocation in ms. Falls back to AGENTS.md value × 1000. */
  invokeTimeoutMs?: number;
}

export interface GoalRunOptions {
  goal: GoalSpec;
  /** Optional explicit run-id; default = ISO of start time. */
  runId?: string;
  /** Override AGENTS.md path resolution (rarely used; tests). */
  agentsMdWorkspace?: string;
}

export interface GoalRunReport {
  goalId: string;
  runId: string;
  startedAt: string;
  endedAt: string;
  state: GoalRunState;
  cyclesAttempted: number;
  cyclesKept: number;
  cyclesDiscarded: number;
  totalCostUsd: number;
  bestCommit?: string;
  shipCandidateCommit?: string;
  terminationReason: string;
  oscillationWarning: boolean;
  summary: GoalRunSummary;
}

export class GoalRunner {
  constructor(private readonly deps: GoalRunnerDeps) {}

  async run(opts: GoalRunOptions): Promise<GoalRunReport> {
    const startedAt = nowIso();
    const startedMs = Date.now();
    const runId = opts.runId ?? startedAt.replace(/[:.]/g, "-");
    const goal = opts.goal;
    const guideWorkspace = opts.agentsMdWorkspace ?? this.deps.workspace;
    const guide = loadAgentsMd(guideWorkspace);
    const resolved = resolvePaths(goal, guide);

    const preflight = preflightInputGuard(goal, guide, resolved);
    if (!preflight.ok) {
      return this.failFast(goal, runId, startedAt, "preflight-fail", preflight.reason ?? "");
    }

    // Background PM session
    const sessionId = `bg-${goal.goal_id}-${runId}`;
    const orgCwd = getOrgDir(goal.org, this.deps.workspace);
    const pmEvents = new FileEventSink(pmEventsPath(this.deps.workspace, goal.org, sessionId));

    // Cycle bookkeeping
    const costTracker = newCostTracker();
    let cycle = 0;
    let consecutiveDiscards = 0;
    let cyclesKept = 0;
    let state: GoalRunState = "RUNNING";
    let terminationReason = "";
    const cycleStatuses: Array<"keep" | "discard"> = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    while ((state as GoalRunState) !== "CONVERGED" && (state as GoalRunState) !== "STOPPED") {
      cycle++;
      const elapsedHours = (Date.now() - startedMs) / 3_600_000;

      const guardCheck = runtimeGuard(
        goal,
        guide,
        costTracker,
        cycle - 1, // already-completed count
        consecutiveDiscards,
        elapsedHours
      );
      if (!guardCheck.shouldContinue) {
        terminationReason = guardCheck.reason ?? "runtime guard";
        state = "STOPPED";
        break;
      }

      const preCycleCommit = takePreCycleSnapshot(
        this.deps.workspace,
        goal.org,
        goal.goal_id,
        cycle
      );

      // Execute pipeline via PM Task tool — single PM invocation that walks
      // all stages. The PM SKILL (goal-md-spec.md) is responsible for chaining
      // Task calls in pipeline order. The runner just builds the prompt and
      // accumulates task_ids/cost from stream-json events.
      const pipelinePrompt = buildPipelinePrompt(goal, guide, cycle, preCycleCommit);
      const turnEvents: AnyEvent[] = [];
      let turnCost = 0;
      const taskIds: string[] = [];

      const stream = this.deps.claude.invokeStreaming({
        sessionId,
        cwd: orgCwd,
        resume: cycle > 1,
        input: singleUserMessage(pipelinePrompt),
        excludeDynamicSystemPromptSections: true,
        includePartialMessages: false,
        maxBudgetUsd: goal.cost_budget.per_cycle_usd,
        timeoutMs:
          this.deps.invokeTimeoutMs ?? guide.stage_timeout_seconds * 1000 * goal.pipeline.length,
        appendSystemPrompt: buildPmSystemPromptSuffix(goal, guide),
      });

      for await (const line of stream.lines) {
        this.processStreamLine(line, turnEvents, taskIds, (cost) => {
          turnCost = cost;
        });
      }
      const exit = await stream.done;
      // Persist events for forensics
      for (const ev of turnEvents) pmEvents.append(ev);

      if (exit.exitCode !== 0 && exit.exitCode !== null) {
        terminationReason = `claude exited with code ${exit.exitCode}`;
        state = "STOPPED";
        break;
      }

      recordCycleCost(costTracker, cycle, turnCost);

      // Evaluate metrics + keep/discard
      const evalOut = await evaluateCycle(
        {
          workspace: this.deps.workspace,
          orgSlug: goal.org,
          goalId: goal.goal_id,
          goal,
          cycle,
          preCycleCommit,
          taskIds,
          timestamp: nowIso(),
          description: `cycle-${cycle} ${state}`,
        },
        this.deps.measurer
      );

      cycleStatuses.push(evalOut.status);
      if (evalOut.status === "keep") {
        cyclesKept++;
        consecutiveDiscards = 0;
        // State machine — CONFIRMING ladder.
        if (state === "RUNNING") state = "CONFIRMING1";
        else if (state === "CONFIRMING1") state = "CONFIRMING2";
        else if (state === "CONFIRMING2") {
          state = "CONVERGED";
          terminationReason = "metric threshold confirmed 3 consecutive cycles";
        }
      } else {
        consecutiveDiscards++;
        // Any failure rolls confirm state back to RUNNING.
        state = "RUNNING";
      }
    }

    const endedAt = nowIso();
    const oscillationWarning = detectOscillation(cycleStatuses);

    // Write _last-run.md for morning-brief routine
    const summary = summarizeRun(
      this.deps.workspace,
      goal.org,
      goal.goal_id,
      costTracker.per_cycle_usd
    );
    writeLastRun(this.deps.workspace, goal, {
      runId,
      startedAt,
      endedAt,
      state,
      cyclesAttempted: cycle,
      cyclesKept,
      cyclesDiscarded: cycle - cyclesKept,
      summary,
      terminationReason,
      oscillationWarning,
    });

    return {
      goalId: goal.goal_id,
      runId,
      startedAt,
      endedAt,
      state,
      cyclesAttempted: cycle,
      cyclesKept,
      cyclesDiscarded: cycle - cyclesKept,
      totalCostUsd: costTracker.total_usd,
      bestCommit: summary.bestCycle?.commit,
      shipCandidateCommit: summary.bestCycle?.commit,
      terminationReason,
      oscillationWarning,
      summary,
    };
  }

  private failFast(
    goal: GoalSpec,
    runId: string,
    startedAt: string,
    state: "preflight-fail" | "other",
    reason: string
  ): GoalRunReport {
    const summary = summarizeRun(this.deps.workspace, goal.org, goal.goal_id, {});
    void state;
    return {
      goalId: goal.goal_id,
      runId,
      startedAt,
      endedAt: nowIso(),
      state: "STOPPED",
      cyclesAttempted: 0,
      cyclesKept: 0,
      cyclesDiscarded: 0,
      totalCostUsd: 0,
      terminationReason: reason,
      oscillationWarning: false,
      summary,
    };
  }

  private processStreamLine(
    line: StreamJsonOutputLine,
    events: AnyEvent[],
    taskIds: string[],
    setCost: (n: number) => void
  ): void {
    if (line.type === "system" && (line as { subtype?: string }).subtype === "task_started") {
      const l = line as unknown as { task_id: string; tool_use_id: string; description?: string };
      taskIds.push(l.task_id);
      events.push({
        ts: nowIso(),
        kind: "spawn.start",
        taskId: l.task_id,
        toolUseId: l.tool_use_id,
        agent: l.description ?? "(unknown)",
        description: l.description ?? "",
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
      events.push(
        l.status === "completed"
          ? {
              ts: nowIso(),
              kind: "spawn.complete",
              taskId: l.task_id,
              toolUseId: l.tool_use_id,
              totalTokens: usage.total_tokens,
              toolUses: usage.tool_uses,
              durationMs: usage.duration_ms,
            }
          : {
              ts: nowIso(),
              kind: "spawn.fail",
              taskId: l.task_id,
              toolUseId: l.tool_use_id,
              status: l.status,
            }
      );
      return;
    }
    if (line.type === "result") {
      const l = line as { total_cost_usd?: number };
      setCost(Number(l.total_cost_usd ?? 0));
    }
  }
}

// ---------- prompt builders ----------

function buildPipelinePrompt(
  goal: GoalSpec,
  guide: { exists: boolean; source_path: string },
  cycle: number,
  preCycleCommit: string
): string {
  return [
    `[GOAL CYCLE ${cycle}] ${goal.title}`,
    "",
    goal.preamble || "",
    "",
    `Workflow id: wf-${goal.goal_id}-cycle-${cycle}`,
    `Pre-cycle commit (engine snapshot): ${preCycleCommit}`,
    "",
    "Run the following pipeline IN ORDER. For each stage, call the Task tool with",
    "the specified subagent and the stage prompt. Embed `[stage:stage-N-<slug> wf:wf-",
    `${goal.goal_id}-cycle-${cycle}]\` as the first line of each Task prompt (v0.3.0+ marker).`,
    "",
    "Pipeline:",
    ...goal.pipeline.map(
      (s, i) => `  ${i + 1}. agent=${s.agent} — ${s.task}`
    ),
    "",
    `Persistent guide (AGENTS.md ${guide.exists ? "loaded" : "missing — defaults applied"}):`,
    "  - immutable_paths and modifiable_paths are enforced by the engine.",
    "  - external side-effects (messenger direct send, payment, etc.) are forbidden.",
    "  - Results are surfaced via morning-brief — do NOT message the user directly.",
    "",
    "When the pipeline completes, end with a brief 1-line summary so the engine can",
    "record the cycle description. The engine then measures metrics and decides keep/discard.",
  ].join("\n");
}

function buildPmSystemPromptSuffix(goal: GoalSpec, guide: { raw_body: string }): string {
  return [
    "",
    "## v0.4 autonomous goal run — system note",
    `You are running goal ${goal.goal_id} in dedicated background mode.`,
    "Output guard: NEVER post to the messenger directly. Results flow through",
    "morning-brief on the next 08:00 brief.",
    "",
    "Persistent guide (AGENTS.md) excerpt:",
    truncate(guide.raw_body, 4000),
  ].join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n…[truncated for system prompt]";
}

// ---------- _last-run.md ----------

interface LastRunInput {
  runId: string;
  startedAt: string;
  endedAt: string;
  state: GoalRunState;
  cyclesAttempted: number;
  cyclesKept: number;
  cyclesDiscarded: number;
  summary: GoalRunSummary;
  terminationReason: string;
  oscillationWarning: boolean;
}

function writeLastRun(workspace: string, goal: GoalSpec, info: LastRunInput): void {
  const dir = goalDir(workspace, goal.org, goal.goal_id);
  fs.mkdirSync(dir, { recursive: true });
  const lines: string[] = [
    `# Goal Run — ${goal.goal_id}`,
    "",
    `**Goal**: ${goal.title}`,
    `**Run id**: ${info.runId}`,
    `**Started**: ${info.startedAt}`,
    `**Ended**: ${info.endedAt}`,
    `**Final state**: ${info.state}`,
    `**Termination reason**: ${info.terminationReason}`,
    "",
    `## Cycle stats`,
    `- Attempted: ${info.cyclesAttempted}`,
    `- Kept: ${info.cyclesKept}`,
    `- Discarded: ${info.cyclesDiscarded}`,
    `- Total cost: $${info.summary.totalCostUsd.toFixed(4)}`,
    "",
  ];
  if (info.summary.bestCycle) {
    lines.push(
      "## Ship candidate",
      `- Cycle: ${info.summary.bestCycle.cycle}`,
      `- Commit: \`${info.summary.bestCycle.commit}\``,
      `- Composite score: ${info.summary.bestCycle.composite_score.toFixed(4)}`,
      `- Metric values:`,
      ...Object.entries(info.summary.bestCycle.metric_values).map(
        ([k, v]) => `  - ${k}: ${v}`
      ),
      ""
    );
  } else {
    lines.push("## Ship candidate", "- None — no cycle cleared the metric thresholds.", "");
  }
  if (info.oscillationWarning) {
    lines.push(
      "## ⚠ Oscillation warning",
      "Last 5 cycles flipped between keep↔discard ≥ 3 times — threshold may be too tight.",
      ""
    );
  }
  fs.writeFileSync(path.join(dir, "_last-run.md"), lines.join("\n"), "utf-8");
  // Reference workflowEventsPath for forensics linkage if a workflow was created.
  void workflowEventsPath;
}

// ---------- helpers ----------

function detectOscillation(statuses: Array<"keep" | "discard">): boolean {
  if (statuses.length < 5) return false;
  const last5 = statuses.slice(-5);
  let flips = 0;
  for (let i = 1; i < last5.length; i++) {
    if (last5[i] !== last5[i - 1]) flips++;
  }
  return flips >= 3;
}

/** Generate a session-id slug for the background PM session. Caller can also
 *  derive their own; this is a convenience for CLI display. */
export function backgroundSessionId(goalId: string): string {
  return `bg-${goalId}-${randomUUID()}`;
}
