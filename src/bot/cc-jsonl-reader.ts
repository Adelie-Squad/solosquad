import fs from "fs";
import path from "path";
import { homedir } from "os";

/**
 * v0.3.0 — read Claude Code's own session jsonl files.
 *
 * Used by workflow-reconciler.ts when the bot crashed after a PM message
 * was processed (claude wrote the assistant reply to its jsonl) but
 * before the messenger pipe got to deliver it. We re-emit the most
 * recent assistant turn so the user sees the reply on bot restart.
 *
 * Couples us to Claude Code's internal jsonl format — keep it defensive.
 * Every helper here returns null on any parse/structure miss instead of
 * throwing.
 *
 * Per docs/plan/v0.3-pm-mode-orchestration.md §3.2 + RECOVERY-AND-TEST-DESIGN.md §3.4.
 */

export interface AssistantTurn {
  text: string;
  /** Claude Code's per-message uuid (different from session_id). */
  uuid?: string;
  /** ISO timestamp from the jsonl line (or null if absent). */
  timestamp?: string;
  /** "end_turn", "tool_use", "max_tokens", etc. */
  stopReason?: string | null;
}

/**
 * Encode a working-directory the same way Claude Code does when it picks
 * the project subdirectory under `~/.claude/projects/`.
 *
 * Empirically: drive colons collapse, slashes become "-", leading dashes
 * are not stripped (observed `C--Users-...` on Windows).
 */
export function encodeCwdForClaudeCode(cwd: string): string {
  return cwd.replace(/[/\\:]/g, "-");
}

export function sessionJsonlPath(cwd: string, sessionId: string): string {
  return path.join(
    homedir(),
    ".claude",
    "projects",
    encodeCwdForClaudeCode(cwd),
    `${sessionId}.jsonl`
  );
}

interface ParsedLine {
  type?: string;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
    stop_reason?: string | null;
  };
  uuid?: string;
  timestamp?: string;
}

/**
 * Return the last `{type:"assistant", message:{role:"assistant", content:[{type:"text"}…]}}`
 * line in the given session jsonl. Returns null if the file is missing,
 * unparseable, or has no usable assistant turn.
 */
export function readLastAssistantTurn(jsonlPath: string): AssistantTurn | null {
  if (!fs.existsSync(jsonlPath)) return null;

  let lines: string[];
  try {
    lines = fs.readFileSync(jsonlPath, "utf-8").split(/\r?\n/);
  } catch {
    return null;
  }

  // Scan from the tail.
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    let obj: ParsedLine;
    try {
      obj = JSON.parse(raw) as ParsedLine;
    } catch {
      continue;
    }
    if (obj.type !== "assistant") continue;
    const content = obj.message?.content;
    if (!Array.isArray(content)) continue;

    const text = content
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => String(b.text))
      .join("");
    if (!text) continue;

    return {
      text,
      uuid: obj.uuid,
      timestamp: obj.timestamp,
      stopReason: obj.message?.stop_reason ?? null,
    };
  }

  return null;
}

/**
 * Quick "does this jsonl belong to a still-recoverable session" check.
 * Returns the timestamp of the latest line or null.
 */
export function readLatestTimestamp(jsonlPath: string): string | null {
  if (!fs.existsSync(jsonlPath)) return null;
  let lines: string[];
  try {
    lines = fs.readFileSync(jsonlPath, "utf-8").split(/\r?\n/);
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i].trim();
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw) as ParsedLine;
      if (obj.timestamp) return obj.timestamp;
    } catch {
      // try next
    }
  }
  return null;
}
