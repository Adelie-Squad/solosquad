import type {
  AuthStatus,
  ClaudeInvocation,
  ClaudeInvocationResult,
  ClaudeProcessFactory,
  ClaudeStreamingResult,
  StreamJsonInputLine,
  StreamJsonOutputLine,
} from "../src/bot/claude-process.js";

/**
 * Test harness for unit-testing pm-runner without spawning real Claude Code.
 *
 * Pattern (per docs/plan/v0.3-pm-mode-orchestration.md §11 success criteria):
 *   const fake = new FakeClaudeProcessFactory();
 *   fake.registerScenario({ resume: true }, [...]);
 *   const pm = new PmRunner({ claude: fake, ... });
 *   await pm.handleUserMessage(...);
 *   assert.equal(fake.invocations.length, 1);
 */

export interface Scenario {
  lines: StreamJsonOutputLine[];
  stderr?: string;
  unparsedStdout?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  delayMsPerLine?: number;
}

export interface ScenarioKey {
  resume?: boolean;
  sessionId?: string;
  /** Match against the first input line's user text (or stringified content). */
  firstInputContains?: string;
}

export interface RecordedInvocation extends ClaudeInvocation {
  collectedInput: StreamJsonInputLine[];
}

export class FakeClaudeProcessFactory implements ClaudeProcessFactory {
  readonly invocations: RecordedInvocation[] = [];
  private scenarios: Array<{ key: ScenarioKey; scenario: Scenario }> = [];
  private defaultScenario: Scenario | null = null;
  private authResult: AuthStatus = { loggedIn: true, subscriptionType: "max" };

  beforeInvoke: (idx: number) => void = () => {};
  afterInvoke: (idx: number) => void = () => {};

  registerScenario(key: ScenarioKey, scenario: Scenario): void {
    this.scenarios.push({ key, scenario });
  }

  setDefaultScenario(scenario: Scenario): void {
    this.defaultScenario = scenario;
  }

  setAuthStatus(status: AuthStatus): void {
    this.authResult = status;
  }

  private match(inv: ClaudeInvocation, firstInputText: string): Scenario {
    for (const { key, scenario } of this.scenarios) {
      if (key.resume !== undefined && key.resume !== inv.resume) continue;
      if (key.sessionId !== undefined && key.sessionId !== inv.sessionId) continue;
      if (
        key.firstInputContains !== undefined &&
        !firstInputText.includes(key.firstInputContains)
      )
        continue;
      return scenario;
    }
    if (this.defaultScenario) return this.defaultScenario;
    return {
      lines: [
        {
          type: "system",
          subtype: "init",
          session_id: inv.sessionId,
          cwd: inv.cwd,
          tools: [],
          agents: [],
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "(default fake reply)",
          session_id: inv.sessionId,
          total_cost_usd: 0,
        },
      ],
    };
  }

  async invoke(inv: ClaudeInvocation): Promise<ClaudeInvocationResult> {
    const stream = this.invokeStreaming(inv);
    const lines: StreamJsonOutputLine[] = [];
    for await (const line of stream.lines) {
      lines.push(line);
    }
    const exit = await stream.done;
    return {
      exitCode: exit.exitCode,
      signal: exit.signal,
      stdoutLines: lines,
      stderr: exit.stderr,
      unparsedStdout: exit.unparsedStdout,
      durationMs: 0,
    };
  }

  invokeStreaming(inv: ClaudeInvocation): ClaudeStreamingResult {
    const idx = this.invocations.length;
    const record: RecordedInvocation = { ...inv, collectedInput: [] };
    this.invocations.push(record);
    this.beforeInvoke(idx);

    const stdoutQueue: StreamJsonOutputLine[] = [];
    let resolveNext: ((v: IteratorResult<StreamJsonOutputLine>) => void) | null = null;
    let done = false;
    let aborted = false;
    let exitInfo: {
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stderr: string;
      unparsedStdout: string;
    } = { exitCode: 0, signal: null, stderr: "", unparsedStdout: "" };
    const exitWaiters: Array<() => void> = [];

    function push(line: StreamJsonOutputLine) {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: line, done: false });
      } else {
        stdoutQueue.push(line);
      }
    }

    function complete() {
      done = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ value: undefined as never, done: true });
      }
      for (const w of exitWaiters) w();
    }

    (async () => {
      const inputArr: StreamJsonInputLine[] = [];
      for await (const line of inv.input) {
        inputArr.push(line);
        record.collectedInput.push(line);
      }

      let firstInputText = "";
      if (inputArr.length > 0) {
        const c = inputArr[0].message.content;
        firstInputText = typeof c === "string" ? c : JSON.stringify(c);
      }
      const scenario = this.match(inv, firstInputText);

      for (const line of scenario.lines) {
        if (aborted) break;
        if (scenario.delayMsPerLine) {
          await sleep(scenario.delayMsPerLine);
        }
        push(line);
      }
      exitInfo = {
        exitCode: scenario.exitCode ?? 0,
        signal: scenario.signal ?? null,
        stderr: scenario.stderr ?? "",
        unparsedStdout: scenario.unparsedStdout ?? "",
      };
      this.afterInvoke(idx);
      complete();
    })().catch((e) => {
      exitInfo = {
        exitCode: 1,
        signal: null,
        stderr: `[fake scenario error] ${String(e)}`,
        unparsedStdout: "",
      };
      this.afterInvoke(idx);
      complete();
    });

    const linesIter: AsyncIterable<StreamJsonOutputLine> = {
      [Symbol.asyncIterator](): AsyncIterator<StreamJsonOutputLine> {
        return {
          next(): Promise<IteratorResult<StreamJsonOutputLine>> {
            if (stdoutQueue.length > 0) {
              return Promise.resolve({ value: stdoutQueue.shift()!, done: false });
            }
            if (done) {
              return Promise.resolve({ value: undefined as never, done: true });
            }
            return new Promise<IteratorResult<StreamJsonOutputLine>>((resolve) => {
              resolveNext = resolve;
            });
          },
        };
      },
    };

    const donePromise = new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
      stderr: string;
      unparsedStdout: string;
    }>((resolve) => {
      const finish = () => resolve(exitInfo);
      if (done) finish();
      else exitWaiters.push(finish);
    });

    return {
      lines: linesIter,
      abort: () => {
        aborted = true;
        try {
          complete();
        } catch {
          // ignore
        }
      },
      done: donePromise,
    };
  }

  async authStatus(): Promise<AuthStatus> {
    return this.authResult;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- helper builders for scripted scenarios ----------

export function textAssistantLine(
  sessionId: string,
  text: string,
  opts?: { stopReason?: string | null }
): StreamJsonOutputLine {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      stop_reason: opts?.stopReason ?? "end_turn",
    },
    session_id: sessionId,
  };
}

export function initLine(
  sessionId: string,
  cwd: string,
  agents: string[] = []
): StreamJsonOutputLine {
  return {
    type: "system",
    subtype: "init",
    session_id: sessionId,
    cwd,
    tools: [],
    agents,
  };
}

export function resultLine(
  sessionId: string,
  result: string,
  opts?: { costUsd?: number; isError?: boolean }
): StreamJsonOutputLine {
  return {
    type: "result",
    subtype: opts?.isError ? "error_during_execution" : "success",
    is_error: opts?.isError ?? false,
    result,
    session_id: sessionId,
    total_cost_usd: opts?.costUsd ?? 0.01,
    stop_reason: "end_turn",
    terminal_reason: "completed",
  };
}

export function taskStartedLine(
  sessionId: string,
  taskId: string,
  toolUseId: string,
  subagent: string,
  prompt: string
): StreamJsonOutputLine {
  return {
    type: "system",
    subtype: "task_started",
    task_id: taskId,
    tool_use_id: toolUseId,
    task_type: "local_agent",
    description: `Run ${subagent}`,
    prompt,
    session_id: sessionId,
    uuid: `u-${taskId}`,
  };
}

export function taskNotificationLine(
  sessionId: string,
  taskId: string,
  toolUseId: string,
  status: "completed" | "failed",
  usage: { total_tokens: number; tool_uses: number; duration_ms: number }
): StreamJsonOutputLine {
  return {
    type: "system",
    subtype: "task_notification",
    task_id: taskId,
    tool_use_id: toolUseId,
    status,
    summary: `${status}`,
    usage,
    uuid: `u-notif-${taskId}`,
    session_id: sessionId,
  };
}
