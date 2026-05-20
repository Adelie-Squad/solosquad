/**
 * v0.10.0 — LLM backend adapter interface.
 *
 * SoloSquad v0.x is hardcoded to Claude Code Max as the sole AI backend.
 * v0.10 introduces this abstraction layer so a future Codex (or other
 * OAuth-based AI CLI) backend can be plugged in without changing every
 * call site. See `docs/plan/v0.10-llm-backend-abstraction.md` §2 for the
 * 10 implementation blockers that prevent a working Codex backend in v0.10
 * (deferred to v1.x slots).
 *
 * **Scope of v0.10**:
 *   - Define the adapter interface
 *   - Wrap the existing Claude Code invocation as `ClaudeAdapter`
 *   - Provide `CodexAdapter` as a *stub* that throws an informative error
 *
 * **NOT in scope**:
 *   - Migrating existing `runClaude` call sites (claude-runner.ts,
 *     scheduler/index.ts, run-routine.ts) to the adapter. Those stay as-is
 *     for v0.10. Point-of-use migration happens in v0.10.x patches.
 *   - Any actual Codex invocation (10 blockers).
 *
 * **Why the stub exists**: so `solosquad init` can offer a backend choice
 * and `workspace.yaml.llm_backend` can record "codex". Selecting Codex
 * surfaces the architectural reality to the user immediately at spawn time
 * with a clear error message + plan reference.
 */

export type LlmBackend = "claude" | "codex";

export interface LlmAuthStatus {
  loggedIn: boolean;
  backend: LlmBackend;
  /** Backend-specific fields (e.g. Claude's subscriptionType, Codex's API tier). */
  details?: Record<string, unknown>;
}

export interface LlmInvocation {
  prompt: string;
  cwd: string;
  /** Optional — persistent session id (Claude's `--resume`). Codex stub ignores. */
  sessionId?: string;
  timeoutMs?: number;
  /** v0.5 paperclip envelope — per-call USD cap. */
  maxBudgetUsd?: number;
}

export interface LlmAdapter {
  readonly backend: LlmBackend;
  /**
   * Single invocation. Returns the full text output. Adapters are responsible
   * for surfacing backend-specific errors (auth failure, network, etc.) as
   * thrown Error or as the resolved string (mirroring existing `runClaude`).
   */
  invoke(inv: LlmInvocation): Promise<string>;
  /** Probe login status. */
  authStatus(): Promise<LlmAuthStatus>;
  /**
   * Optional — spawn a specialist sub-agent. Claude maps this to its built-in
   * Task tool (depth=1). Codex stub throws (see plan §2.2).
   */
  spawnSpecialist?(inv: LlmInvocation): Promise<string>;
}

/**
 * Get the configured adapter. Reads `workspace.yaml.llm_backend` (or accepts
 * explicit backend). Falls back to "claude" if unset (v0.9.x workspaces
 * predate this field, so they default to the historically-supported backend).
 */
export function getAdapter(backend: LlmBackend = "claude"): LlmAdapter {
  if (backend === "claude") return new ClaudeAdapter();
  if (backend === "codex") return new CodexAdapter();
  throw new Error(`Unknown LLM backend: ${backend}`);
}

// ---------------------------------------------------------------------------
// ClaudeAdapter — wraps the existing runClaude logic.
// ---------------------------------------------------------------------------

/**
 * v0.10 — thin wrapper around `src/bot/claude-runner.ts:runClaude`. Does NOT
 * change behavior. Existing call sites continue to import `runClaude` directly
 * for v0.10; this adapter exists so v0.10.x can incrementally migrate them.
 *
 * For auth status, see `src/bot/claude-process.ts:RealClaudeProcessFactory.authStatus`
 * (not wrapped here because the legacy implementation includes more nuance —
 * subscription type, org id, etc. — than this minimal adapter needs).
 */
class ClaudeAdapter implements LlmAdapter {
  readonly backend = "claude" as const;

  async invoke(inv: LlmInvocation): Promise<string> {
    // Lazy import keeps this module light at boot time.
    const { runClaude } = await import("../bot/claude-runner.js");
    return runClaude(inv.prompt, inv.cwd, inv.timeoutMs ?? 120_000);
  }

  async authStatus(): Promise<LlmAuthStatus> {
    const { RealClaudeProcessFactory } = await import("../bot/claude-process.js");
    const factory = new RealClaudeProcessFactory();
    const status = await factory.authStatus();
    return {
      loggedIn: status.loggedIn,
      backend: "claude",
      details: { ...status },
    };
  }
}

// ---------------------------------------------------------------------------
// CodexAdapter — stub. Throws with a clear pointer to the plan.
// ---------------------------------------------------------------------------

/**
 * v0.10 stub. Selecting `codex` as the workspace's `llm_backend` records the
 * choice in `workspace.yaml` but spawns fail at invoke time with this error.
 *
 * Plan reference: docs/plan/v0.10-llm-backend-abstraction.md §2 enumerates
 * the 10 blockers preventing real Codex support (PM session model, Task tool,
 * stream format, SKILL.md schema, auth probe, system-prompt injection, cost
 * tracking format, dev-confirm hook position, context window, pricing model).
 */
class CodexAdapter implements LlmAdapter {
  readonly backend = "codex" as const;

  invoke(): Promise<string> {
    throw new Error(
      "Codex backend is not yet implemented (v0.10 stub).\n" +
        "See docs/plan/v0.10-llm-backend-abstraction.md §2 for the 10 architectural blockers.\n" +
        "To use the working backend, edit workspace.yaml: llm_backend: claude",
    );
  }

  authStatus(): Promise<LlmAuthStatus> {
    return Promise.resolve({
      loggedIn: false,
      backend: "codex",
      details: {
        stub: true,
        plan: "docs/plan/v0.10-llm-backend-abstraction.md",
      },
    });
  }
}
