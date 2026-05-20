import { test } from "node:test";
import assert from "node:assert/strict";
import { getAdapter } from "../src/llm/adapter.js";

/**
 * v0.10.0 §3.3 — regression catcher for the LLM adapter stub contract.
 *
 * Verifies that:
 *   1. `getAdapter("codex")` returns an adapter (no error at construction)
 *   2. `codexAdapter.invoke()` THROWS with a message that references the
 *      v0.10 plan + tells the user how to recover
 *   3. `codexAdapter.authStatus()` returns `{ loggedIn: false, backend: "codex" }`
 *      with a stub flag in details
 *   4. `getAdapter("claude")` returns an adapter (`backend === "claude"`)
 *   5. `getAdapter` throws on unknown backend
 *
 * Per `docs/plan/v0.10-llm-backend-abstraction.md` §7 — the *honest stub*
 * contract: surface the architectural reality at invoke time so users don't
 * mistake the wizard's Codex option for working support.
 */

test("getAdapter('codex') returns adapter; invoke() throws with plan reference", async () => {
  const adapter = getAdapter("codex");
  assert.equal(adapter.backend, "codex");

  let thrown: Error | undefined;
  try {
    await adapter.invoke({ prompt: "test", cwd: process.cwd() });
  } catch (e) {
    thrown = e as Error;
  }
  assert.ok(thrown, "CodexAdapter.invoke() must throw (v0.10 stub)");
  assert.match(
    thrown!.message,
    /not yet implemented/i,
    "error must say it's not implemented",
  );
  assert.match(
    thrown!.message,
    /v0\.10-llm-backend-abstraction\.md/,
    "error must reference the plan doc for diagnostics",
  );
  assert.match(
    thrown!.message,
    /llm_backend:\s*claude/,
    "error must tell user how to recover (set llm_backend to claude)",
  );
});

test("getAdapter('codex').authStatus() reports loggedIn: false + stub flag", async () => {
  const adapter = getAdapter("codex");
  const status = await adapter.authStatus();
  assert.equal(status.loggedIn, false);
  assert.equal(status.backend, "codex");
  assert.equal(status.details?.stub, true);
});

test("getAdapter('claude') returns Claude adapter", () => {
  const adapter = getAdapter("claude");
  assert.equal(adapter.backend, "claude");
});

test("getAdapter throws on unknown backend", () => {
  assert.throws(
    () => getAdapter("openai" as unknown as "claude" | "codex"),
    /Unknown LLM backend/,
  );
});
