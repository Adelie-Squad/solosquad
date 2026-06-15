import { execFile, spawn, type ChildProcess } from "child_process";

/**
 * v0.3.0 — typed wrapper around `claude --print` subprocess.
 *
 * Replaces the single-shot `claude-runner.ts` for Chief session use. The
 * scheduler still uses `claude-runner.ts` for stateless routine prompts.
 *
 * Design (per docs/plan/v0.3-pm-mode-orchestration.md §3.2 + PoC #1/#2):
 *   - Chief session uses pre-generated `--session-id <uuid>` + `--resume`
 *   - Always `--output-format stream-json --verbose --input-format stream-json`
 *   - `ClaudeProcessFactory` interface lets us swap a Fake impl for unit tests
 *   - Real impl handles Windows shell quoting (DEP0190-safe)
 */

// ---------- stream-json wire types ----------

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_result"; tool_use_id: string; content: string | ContentBlock[]; is_error?: boolean }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "thinking"; thinking: string; signature?: string };

export type StreamJsonInputLine = {
  type: "user";
  message: { role: "user"; content: string | ContentBlock[] };
};

export interface AssistantMessage {
  model?: string;
  id?: string;
  role: "assistant";
  content: ContentBlock[];
  stop_reason?: string | null;
  usage?: TokenUsage;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export interface RateLimitInfo {
  status: "allowed" | "warning" | "exceeded";
  resetsAt?: number;
  rateLimitType?: string;
  overageStatus?: string;
  overageDisabledReason?: string;
  isUsingOverage?: boolean;
}

export type StreamJsonOutputLine =
  | {
      type: "system";
      subtype: "init";
      session_id: string;
      cwd: string;
      tools: string[];
      agents?: string[];
    }
  | {
      type: "system";
      subtype: "task_started";
      task_id: string;
      tool_use_id: string;
      task_type: "local_agent" | string;
      description: string;
      prompt: string;
      session_id: string;
      uuid: string;
    }
  | {
      type: "system";
      subtype: "task_notification";
      task_id: string;
      tool_use_id: string;
      status: "completed" | "failed" | "cancelled";
      summary: string;
      output_file?: string;
      usage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number };
      uuid: string;
      session_id: string;
    }
  | {
      type: "assistant";
      message: AssistantMessage;
      session_id: string;
      uuid?: string;
    }
  | {
      type: "user";
      message: { role: "user"; content: ContentBlock[] };
      parent_tool_use_id: string | null;
      session_id: string;
      uuid?: string;
    }
  | {
      type: "rate_limit_event";
      rate_limit_info: RateLimitInfo;
      session_id: string;
      uuid?: string;
    }
  | {
      type: "result";
      subtype: "success" | "error_max_turns" | "error_during_execution";
      is_error: boolean;
      result: string;
      session_id: string;
      total_cost_usd: number;
      usage?: TokenUsage;
      stop_reason?: string | null;
      terminal_reason?: string;
      duration_ms?: number;
    }
  | {
      // catch-all for forward compatibility
      type: string;
      [k: string]: unknown;
    };

// ---------- factory contract ----------

export interface ClaudeInvocation {
  sessionId: string;
  cwd: string;
  /** true on every call after the session has been created. */
  resume: boolean;
  /** Stream of user/tool_result lines (NDJSON over stdin). */
  input: AsyncIterable<StreamJsonInputLine>;
  /** Default true for PM session — improves cross-call prompt-cache hit rate. */
  excludeDynamicSystemPromptSections?: boolean;
  /** Cap cost per call. Workspace default. */
  maxBudgetUsd?: number;
  /** Default true for PM session so users get realtime partial replies. */
  includePartialMessages?: boolean;
  /** Append to the default system prompt. */
  appendSystemPrompt?: string;
  /** Hard timeout in ms (abort the child if exceeded). */
  timeoutMs?: number;
  /**
   * v0.8.2 §4.2 — Claude Code `--allowed-tools` / `--disallowed-tools`
   * passthrough. When omitted, the CLI's defaults apply (broad permissions —
   * legacy behavior). The PM-session caller (`chief-runner.ts`) keeps these
   * unset; per-spawn engineering tasks set them via `applyDevPermissions()`.
   */
  allowedTools?: string[];
  disallowedTools?: string[];
  /**
   * v0.8.2 §4.2 — pre-check bash allowlist / denylist. Used by the SoloSquad
   * wrapper around Bash tool invocations to reject commands at the *bot* layer
   * before they reach Claude Code (because Claude Code does not yet expose a
   * native bash allowlist flag).
   */
  bashAllowlist?: string[];
  bashDenylist?: string[];
  /**
   * v1.2.9 §E — Claude Code `--permission-mode`. Controls headless tool
   * approval. Unset ⇒ CLI default, where a tool needing approval (Write /
   * Edit / Bash) PROMPTS — which HANGS in non-interactive (`--print`) mode
   * since there's no TTY to answer. Chief-runner sets `acceptEdits` when dev
   * mode is ON so file edits + allow-listed Bash run without a prompt; OFF
   * keeps it unset and instead denies Bash/Edit/Write via `disallowedTools`
   * (deny removes the tool → no hang).
   */
  permissionMode?: "default" | "acceptEdits" | "plan" | "bypassPermissions";
  /**
   * v1.2.9 §E — path to a Claude Code settings file (`--settings`). Used to
   * inject the PreToolUse Bash deny hook in dev-ON mode (blocks git push /
   * pr-merge / pr-close even in compound commands, which CLI deny can't).
   * Merges with the user's own settings as an additive layer.
   */
  settingsPath?: string;
  /**
   * v1.2.7 §A.6 — additional working directories the Claude session can
   * read/write outside of `cwd`. Maps to `claude --add-dir <path1>
   * <path2> ...`. Used by chief-runner to grant the bot's spawn access
   * to every repo registered under `<org>/repositories/` — without
   * this, Chief operating from `cwd=<org>` reports "no access" to
   * repos at `C:\Dev\<repo>` etc.
   */
  addDirs?: string[];
}

export interface ClaudeInvocationResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdoutLines: StreamJsonOutputLine[];
  stderr: string;
  /** stdout content that failed to JSON-parse — surfaced to callers in case the
   * "Not logged in" sentinel arrives instead of stream-json. */
  unparsedStdout: string;
  durationMs: number;
}

export interface ClaudeStreamingResult {
  /** Hot async iterator over parsed stream-json lines. */
  lines: AsyncIterable<StreamJsonOutputLine>;
  /** Abort the child process. */
  abort: () => void;
  /** Resolves after child exit (drain stderr inside). */
  done: Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stderr: string;
    unparsedStdout: string;
  }>;
}

export interface AuthStatus {
  loggedIn: boolean;
  authMethod?: string;
  apiProvider?: string;
  email?: string;
  orgId?: string;
  orgName?: string;
  subscriptionType?: string;
}

export interface ClaudeProcessFactory {
  /** Run a single PM/specialist invocation, accumulate all output, resolve on exit. */
  invoke(inv: ClaudeInvocation): Promise<ClaudeInvocationResult>;

  /** Same as invoke but exposes a hot async iterator for real-time forwarding. */
  invokeStreaming(inv: ClaudeInvocation): ClaudeStreamingResult;

  /** Call `claude auth status --json`. Used at bot startup + on auth-fail recovery. */
  authStatus(): Promise<AuthStatus>;
}

// ---------- Real implementation ----------

const IS_WINDOWS = process.platform === "win32";

/** Sentinel produced by Claude Code itself when the user is not signed in. */
export const NOT_LOGGED_IN_PATTERN = /^Not logged in/m;

/** stderr emitted when `--resume <id>` points at a session that no longer exists. */
export const SESSION_NOT_FOUND_PATTERN = /No conversation found with session ID/;

/** stderr emitted when `--resume <value>` is malformed. */
export const INVALID_SESSION_ID_PATTERN = /requires a valid session ID/;

function buildArgs(inv: ClaudeInvocation): string[] {
  const args: string[] = ["--print"];
  if (inv.resume) {
    args.push("--resume", inv.sessionId);
  } else {
    args.push("--session-id", inv.sessionId);
  }
  args.push("--output-format", "stream-json");
  args.push("--input-format", "stream-json");
  args.push("--verbose");
  if (inv.excludeDynamicSystemPromptSections ?? true) {
    args.push("--exclude-dynamic-system-prompt-sections");
  }
  if (inv.includePartialMessages) {
    args.push("--include-partial-messages");
  }
  if (typeof inv.maxBudgetUsd === "number") {
    args.push("--max-budget-usd", String(inv.maxBudgetUsd));
  }
  if (inv.appendSystemPrompt) {
    args.push("--append-system-prompt", inv.appendSystemPrompt);
  }
  if (inv.permissionMode) {
    args.push("--permission-mode", inv.permissionMode);
  }
  if (inv.settingsPath) {
    args.push("--settings", inv.settingsPath);
  }
  if (inv.allowedTools && inv.allowedTools.length > 0) {
    args.push("--allowed-tools", inv.allowedTools.join(","));
  }
  if (inv.addDirs && inv.addDirs.length > 0) {
    // v1.2.7 §A.6 — `--add-dir` takes space-separated paths as variadic
    // positional values. discord.js / Node's spawn auto-escapes each
    // arg so paths with spaces work without manual quoting.
    args.push("--add-dir", ...inv.addDirs);
  }
  if (inv.disallowedTools && inv.disallowedTools.length > 0) {
    args.push("--disallowed-tools", inv.disallowedTools.join(","));
  }
  return args;
}

/**
 * v0.8.2 §4.2 — Bash command pre-check. Returns null when the command is
 * permitted; returns a rejection reason string otherwise. Exposed so the
 * PM-runner / spawn caller can intercept Bash tool_use blocks emitted by
 * the spawn and short-circuit them with a tool_result.
 *
 * Matching rules:
 *   - DENY wins. Any substring match on `bashDenylist` rejects the command.
 *   - If `bashAllowlist` is empty, no allow check happens (back-compat: PM
 *     session retains full Bash). If non-empty, the command's *first
 *     non-whitespace token sequence* must start with one of the entries (e.g.
 *     entry `"gh pr create"` matches the command `gh pr create --title foo`).
 *
 * `cmd` should be the literal string the SKILL passed to the Bash tool.
 */
export function checkBashCommand(
  cmd: string,
  bashAllowlist: readonly string[] = [],
  bashDenylist: readonly string[] = [],
): { ok: true } | { ok: false; reason: string; matched: string } {
  const trimmed = cmd.trim();
  if (!trimmed) {
    return { ok: false, reason: "empty command", matched: "" };
  }

  // Deny is strict — substring match on raw command (post-trim).
  for (const denied of bashDenylist) {
    if (!denied) continue;
    if (trimmed.includes(denied)) {
      return {
        ok: false,
        reason: `bash command rejected by workspace denylist: matched "${denied}"`,
        matched: denied,
      };
    }
  }

  if (bashAllowlist.length === 0) return { ok: true };

  for (const allow of bashAllowlist) {
    if (!allow) continue;
    if (trimmed === allow) return { ok: true };
    if (trimmed.startsWith(`${allow} `)) return { ok: true };
    if (trimmed.startsWith(`${allow}\t`)) return { ok: true };
  }

  return {
    ok: false,
    reason: `bash command rejected by SKILL allowlist (no entry is a leading-token match)`,
    matched: "",
  };
}

/** Parse a single stream-json line. Returns null on JSON parse failure. */
export function parseLine(raw: string): StreamJsonOutputLine | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as StreamJsonOutputLine;
  } catch {
    return null;
  }
}

export class RealClaudeProcessFactory implements ClaudeProcessFactory {
  async invoke(inv: ClaudeInvocation): Promise<ClaudeInvocationResult> {
    const stream = this.invokeStreaming(inv);
    const lines: StreamJsonOutputLine[] = [];
    for await (const line of stream.lines) {
      lines.push(line);
    }
    const { exitCode, signal, stderr, unparsedStdout } = await stream.done;
    return {
      exitCode,
      signal,
      stdoutLines: lines,
      stderr,
      unparsedStdout,
      durationMs: 0,
    };
  }

  invokeStreaming(inv: ClaudeInvocation): ClaudeStreamingResult {
    const args = buildArgs(inv);
    const child = spawnClaude(args, inv.cwd);

    void streamInput(child, inv.input).catch(() => {});

    let stderr = "";
    let unparsedStdoutTail = "";
    const stdoutQueue: StreamJsonOutputLine[] = [];
    let stdoutBuf = "";
    let resolveNext: ((v: IteratorResult<StreamJsonOutputLine>) => void) | null = null;
    let done = false;
    let exitInfo: { exitCode: number | null; signal: NodeJS.Signals | null } = {
      exitCode: null,
      signal: null,
    };
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

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutBuf += String(chunk);
      let idx: number;
      while ((idx = stdoutBuf.indexOf("\n")) >= 0) {
        const raw = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        const parsed = parseLine(raw);
        if (parsed) {
          push(parsed);
        } else if (raw.trim()) {
          unparsedStdoutTail += raw + "\n";
        }
      }
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.on("close", (code, signal) => {
      if (stdoutBuf.trim()) {
        const parsed = parseLine(stdoutBuf);
        if (parsed) push(parsed);
        else unparsedStdoutTail += stdoutBuf;
        stdoutBuf = "";
      }
      exitInfo = { exitCode: code, signal };
      complete();
    });

    child.on("error", (err) => {
      stderr += `\n[spawn error] ${err.message}`;
      exitInfo = { exitCode: 1, signal: null };
      complete();
    });

    const timer = inv.timeoutMs
      ? setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            // ignore
          }
        }, inv.timeoutMs)
      : null;
    child.on("close", () => {
      if (timer) clearTimeout(timer);
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
      const finish = () =>
        resolve({
          exitCode: exitInfo.exitCode,
          signal: exitInfo.signal,
          stderr,
          unparsedStdout: unparsedStdoutTail,
        });
      if (done) finish();
      else exitWaiters.push(finish);
    });

    return {
      lines: linesIter,
      abort: () => {
        try {
          child.kill("SIGTERM");
        } catch {
          // ignore
        }
      },
      done: donePromise,
    };
  }

  async authStatus(): Promise<AuthStatus> {
    return new Promise<AuthStatus>((resolve) => {
      const useShell = IS_WINDOWS;
      const cmd = useShell ? "claude auth status --json" : "claude";
      const args = useShell ? [] : ["auth", "status", "--json"];
      execFile(
        cmd,
        args,
        { shell: useShell, maxBuffer: 1024 * 1024 },
        (_err, stdout) => {
          try {
            const parsed = JSON.parse(stdout) as AuthStatus;
            resolve(parsed);
          } catch {
            resolve({ loggedIn: false });
          }
        }
      );
    });
  }
}

function spawnClaude(args: string[], cwd: string): ChildProcess {
  if (IS_WINDOWS) {
    const cmd = `claude ${args.map((a) => quoteWindowsArg(a)).join(" ")}`;
    return spawn(cmd, [], { cwd, shell: true });
  }
  return spawn("claude", args, { cwd });
}

function quoteWindowsArg(a: string): string {
  if (a === "" || /[ \t"]/.test(a)) {
    return `"${a.replace(/"/g, '\\"')}"`;
  }
  return a;
}

async function streamInput(
  child: ChildProcess,
  input: AsyncIterable<StreamJsonInputLine>
): Promise<void> {
  const stdin = child.stdin;
  if (!stdin) return;
  try {
    for await (const line of input) {
      stdin.write(JSON.stringify(line) + "\n");
    }
  } finally {
    try {
      stdin.end();
    } catch {
      // ignore
    }
  }
}

/** Convenience: create a single-line input iterable from a user text. */
export async function* singleUserMessage(
  text: string
): AsyncIterable<StreamJsonInputLine> {
  yield { type: "user", message: { role: "user", content: text } };
}
