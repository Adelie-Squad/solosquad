import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.8.1 — `--merge` conflict resolution.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §4.3. Each helper is
 * independently testable: this file owns *policy* (what to do on a clash)
 * but not *I/O orchestration* (which lives in `import.ts`).
 *
 * Invariant: the existing workspace bytes are never modified silently. A
 * conflict is either resolved (dedup, append) or surfaced (rejected with a
 * structured reason, or persisted to a `*.imported.md` sibling for manual
 * merge).
 */

/* -------------------------------------------------------------------------- */
/* Decision types                                                             */
/* -------------------------------------------------------------------------- */

export type MergeDecisionKind =
  | "write"
  | "skip"
  | "append-dedup"
  | "rename-sibling"
  | "reject";

export interface MergeDecision {
  kind: MergeDecisionKind;
  /** Final disk path (set for write / append-dedup / rename-sibling). */
  targetPath?: string;
  /** Final bytes to emit for `write`. */
  bytes?: Buffer;
  /** Reason — surfaced to the user via journal + CLI summary. */
  reason: string;
}

/* -------------------------------------------------------------------------- */
/* JSONL dedup                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Merge two `.jsonl` payloads, deduping by (content hash, ts) per §4.3.
 *
 * Order: existing lines first (preserved), then any *new* incoming lines
 * appended in their original order. A line whose normalized JSON matches an
 * existing line is dropped.
 *
 * Robustness: malformed JSON lines are treated as raw strings (still
 * dedup-able by string identity). Trailing blank lines are stripped.
 */
export function mergeJsonlBuffers(existing: Buffer, incoming: Buffer): Buffer {
  const existingLines = readJsonlLines(existing);
  const incomingLines = readJsonlLines(incoming);
  const seen = new Set<string>();
  const out: string[] = [];

  for (const l of existingLines) {
    const key = jsonlKey(l);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  for (const l of incomingLines) {
    const key = jsonlKey(l);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return Buffer.from(out.join("\n") + (out.length > 0 ? "\n" : ""));
}

function readJsonlLines(buf: Buffer): string[] {
  return normalizeLine(buf.toString("utf-8"))
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

/**
 * Stable key for JSONL deduplication.
 *
 *   1. Try `JSON.parse` → re-stringify with sorted keys + ts. This catches
 *      semantically-equal rows whose disk byte ordering differs.
 *   2. Fall back to a SHA256 of the raw line for malformed JSON.
 */
function jsonlKey(line: string): string {
  try {
    const parsed = JSON.parse(line) as unknown;
    return stableStringify(parsed);
  } catch {
    return "raw:" + createHash("sha256").update(line).digest("hex");
  }
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

/* -------------------------------------------------------------------------- */
/* Per-file conflict policy                                                   */
/* -------------------------------------------------------------------------- */

export interface ConflictContext {
  /** Path inside `<workspace>/`. */
  relPath: string;
  /** Incoming bytes from archive. */
  incomingBytes: Buffer;
  /** Existing bytes on disk, or null if the file doesn't exist. */
  existingBytes: Buffer | null;
  /** Absolute path on the destination filesystem. */
  absPath: string;
  /** "merge" (default) or "replace". */
  mode: "merge" | "replace";
}

/**
 * Decide what to do with a single incoming file. Workflows/goals id
 * conflicts are *not* handled here — they live in `decideOrgConflict` because
 * they need higher-level context (the org slug + the manifest of incoming
 * workflow ids).
 */
export function decideFileConflict(ctx: ConflictContext): MergeDecision {
  // No conflict — straightforward write.
  if (ctx.existingBytes === null) {
    return {
      kind: "write",
      targetPath: ctx.absPath,
      bytes: ctx.incomingBytes,
      reason: "no existing file",
    };
  }

  // Identical content → skip.
  if (
    ctx.existingBytes.byteLength === ctx.incomingBytes.byteLength &&
    ctx.existingBytes.equals(ctx.incomingBytes)
  ) {
    return {
      kind: "skip",
      targetPath: ctx.absPath,
      reason: "identical contents — no-op",
    };
  }

  if (ctx.mode === "replace") {
    return {
      kind: "write",
      targetPath: ctx.absPath,
      bytes: ctx.incomingBytes,
      reason: "--replace mode: overwriting existing file",
    };
  }

  // mode === "merge"

  // JSONL: content-hash dedup + append. Preserves existing order.
  if (ctx.relPath.endsWith(".jsonl")) {
    const merged = mergeJsonlBuffers(ctx.existingBytes, ctx.incomingBytes);
    return {
      kind: "append-dedup",
      targetPath: ctx.absPath,
      bytes: merged,
      reason: "jsonl content-hash dedup + append",
    };
  }

  // AGENTS.md at workspace root, or `core/`/`knowledge/` markdown — write
  // a `.imported.md` sibling so the user can manually reconcile.
  if (isManualMergeMarkdown(ctx.relPath)) {
    return {
      kind: "rename-sibling",
      targetPath: importedSiblingPath(ctx.absPath),
      bytes: ctx.incomingBytes,
      reason: "markdown conflict — saved alongside as `.imported.md` for manual reconciliation",
    };
  }

  // Default: preserve existing, surface conflict to user via rename.
  return {
    kind: "rename-sibling",
    targetPath: importedSiblingPath(ctx.absPath),
    bytes: ctx.incomingBytes,
    reason: "conflict — saved alongside as `.imported` for manual review",
  };
}

function isManualMergeMarkdown(relPath: string): boolean {
  if (relPath === "AGENTS.md") return true;
  if (/^workspace\/AGENTS\.md$/.test(relPath)) return true;
  if (relPath.startsWith("workspace/core/") && relPath.endsWith(".md")) return true;
  if (relPath.startsWith("workspace/knowledge/") && relPath.endsWith(".md")) return true;
  if (/\/core\/.+\.md$/.test(relPath)) return true; // <org>/core/*.md
  if (/\/knowledge\/.+\.md$/.test(relPath)) return true;
  return false;
}

function importedSiblingPath(absPath: string): string {
  const dir = path.dirname(absPath);
  const ext = path.extname(absPath);
  const base = path.basename(absPath, ext);
  if (ext === ".md") return path.join(dir, base + ".imported.md");
  return path.join(dir, base + ".imported" + ext);
}

/* -------------------------------------------------------------------------- */
/* Org-level id conflicts (workflows/goals)                                   */
/* -------------------------------------------------------------------------- */

export interface IdConflictReport {
  workflowConflicts: string[];
  goalConflicts: string[];
}

/**
 * Walk an existing org's workflows/ + goals/ folders and an incoming map of
 * archive paths to surface any id collision. Caller decides whether to
 * reject the import or fall back to `--replace`.
 */
export function detectIdConflicts(opts: {
  orgDir: string;
  incomingWorkflowIds: ReadonlySet<string>;
  incomingGoalIds: ReadonlySet<string>;
}): IdConflictReport {
  const workflowConflicts = collectExistingIds(path.join(opts.orgDir, "workflows"))
    .filter((id) => opts.incomingWorkflowIds.has(id));
  const goalConflicts = collectExistingIds(path.join(opts.orgDir, "goals"))
    .filter((id) => opts.incomingGoalIds.has(id));
  return { workflowConflicts, goalConflicts };
}

function collectExistingIds(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* agent-profile.yaml deep-merge                                              */
/* -------------------------------------------------------------------------- */

/**
 * Deep-merge two parsed YAML objects for `agent-profile.yaml`.
 *
 * Per §4.3: deep-merge with the **narrowing-only invariant**. If the
 * incoming profile *widens* a key (e.g. sets a budget higher than the
 * existing one), the merge is rejected. Callers receive `null` to indicate
 * rejection.
 *
 * Narrowing rule (intentionally simple — full validation lives in the
 * agent-profile validator):
 *   - Numeric: incoming ≤ existing
 *   - Boolean: incoming === existing OR existing === false ↔ incoming === true is rejected
 *   - String/array/object: equal or strict subset
 */
export function mergeAgentProfile(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): { ok: true; merged: Record<string, unknown> } | { ok: false; violations: string[] } {
  const violations: string[] = [];
  const merged: Record<string, unknown> = { ...existing };

  for (const [k, vIncoming] of Object.entries(incoming)) {
    const vExisting = existing[k];
    if (vExisting === undefined) {
      // New key — treat as widening (rejected).
      violations.push(`adds new key "${k}" — widening invariant`);
      continue;
    }
    if (typeof vExisting === "number" && typeof vIncoming === "number") {
      if (vIncoming > vExisting) {
        violations.push(`"${k}" widens from ${vExisting} to ${vIncoming}`);
        continue;
      }
      merged[k] = vIncoming;
      continue;
    }
    if (typeof vExisting === "object" && vExisting !== null && typeof vIncoming === "object" && vIncoming !== null) {
      const sub = mergeAgentProfile(
        vExisting as Record<string, unknown>,
        vIncoming as Record<string, unknown>,
      );
      if (!sub.ok) {
        for (const v of sub.violations) violations.push(`${k}.${v}`);
      } else {
        merged[k] = sub.merged;
      }
      continue;
    }
    if (vExisting === vIncoming) {
      merged[k] = vIncoming;
      continue;
    }
    violations.push(`"${k}" changes from ${JSON.stringify(vExisting)} to ${JSON.stringify(vIncoming)}`);
  }

  if (violations.length > 0) return { ok: false, violations };
  return { ok: true, merged };
}
