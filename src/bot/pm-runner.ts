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

/**
 * v1.3.0 — PM session driver.
 *
 * Wraps the long-lived Claude Code session that talks to the user. The flow
 * (per docs/plan/v0.3-pm-mode-orchestration.md §4.2):
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

export interface PmRunnerDeps {
  claude: ClaudeProcessFactory;
  sessions: SessionStore;
  events: (orgSlug: string, userId: string) => EventSink;
  maxBudgetUsd?: number;
  timeoutMs?: number;
}

export interface PmCall {
  userId: string;
  orgSlug: string;
  orgCwd: string;
  userText: string;
}

export interface PmReply {
  text: string;
  costUsd: number;
  durationMs: number;
  sessionRotated: boolean;
  rateLimited: boolean;
  spawnCount: number;
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

export class PmRunner {
  private readonly mutex = new SessionMutex();

  constructor(private readonly deps: PmRunnerDeps) {}

  async handleUserMessage(call: PmCall): Promise<PmReply> {
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

  private async runTurn(call: PmCall): Promise<PmReply> {
    const sink = this.deps.events(call.orgSlug, call.userId);
    const startedAt = Date.now();
    sink.append({
      ts: nowIso(),
      kind: "pm.message_in",
      text: call.userText,
      userId: call.userId,
    });

    const result = await this.invokeWithSessionRecovery(call, sink, false);

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

    return {
      text: result.text,
      costUsd: result.costUsd,
      durationMs,
      sessionRotated: result.sessionRotated,
      rateLimited: result.rateLimited,
      spawnCount: result.spawnCount,
    };
  }

  private async invokeWithSessionRecovery(
    call: PmCall,
    sink: EventSink,
    rotatedAlready: boolean
  ): Promise<InternalTurnResult> {
    const { record, fresh } = this.deps.sessions.ensure(call.orgSlug, call.userId);
    const sessionId = record.sessionId;
    // After a rotation, the new session-id was just minted by SessionStore.rotate
    // and has never been used with claude — treat it as fresh so we pass
    // --session-id <uuid> instead of --resume <uuid>.
    const useResume = !fresh && !rotatedAlready;

    const stream = this.deps.claude.invokeStreaming({
      sessionId,
      cwd: call.orgCwd,
      resume: useResume,
      input: singleUserMessage(call.userText),
      excludeDynamicSystemPromptSections: true,
      includePartialMessages: true,
      maxBudgetUsd: this.deps.maxBudgetUsd ?? 5,
      timeoutMs: this.deps.timeoutMs ?? 300_000,
    });

    let costUsd = 0;
    let rateLimited = false;
    let spawnCount = 0;
    let lastResultText = "";
    const collectedAssistantText: string[] = [];

    for await (const line of stream.lines) {
      this.processLine(line, sink, {
        onAssistantText: (text) => collectedAssistantText.push(text),
        onSpawn: () => spawnCount++,
        onRateLimit: () => (rateLimited = true),
        onResult: (text, cost) => {
          lastResultText = text;
          costUsd = cost;
        },
        userId: call.userId,
      });
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
      const retry = await this.invokeWithSessionRecovery(call, sink, true);
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

    const text = lastResultText || collectedAssistantText.join("");
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
