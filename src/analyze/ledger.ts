import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";
import type { ScannedSkill } from "./scanner.js";

/**
 * v0.5 §6.4 — analysis ledger YAML for `<repo>/.solosquad/analysis-ledger.yaml`.
 *
 * `pending_v0.6_redestination` is the bridge to v0.6 §2.2 receiver-side
 * automatic re-destination (read by `src/migrations/scripts/0.5.0-to-0.6.0.ts`
 * once that lands). v0.5 marks `role` + `domain` entries true on apply; the
 * v0.6 migrator scans for `true` items and moves them to their final homes
 * (`<org>/agent-profile.yaml` and `<org>/domain/` respectively).
 *
 * The dotted property name is preserved in the YAML serialization — TypeScript
 * can't model the literal identifier, so we treat the property via an indexed
 * access (`[PENDING_KEY]`) on a plain object shape.
 */

export const LEDGER_SCHEMA_VERSION = 1;
export const LEDGER_REL_PATH = path.join(".solosquad", "analysis-ledger.yaml");
export const PENDING_KEY = "pending_v0.6_redestination";

export type ClassificationLabel =
  | "role"
  | "workflow"
  | "codebase-fact"
  | "domain";

/**
 * Plain object — TypeScript can't declare a property literally named
 * `pending_v0.6_redestination` (the dot is not a valid identifier character),
 * so we use an index signature and require callers to read/write via
 * `PENDING_KEY`. The `boolean | string | null | undefined` value type covers
 * the flag plus the known siblings.
 */
export interface LedgerEntry {
  path: string;
  hash: string;
  classification: ClassificationLabel;
  confidence: number;
  destination: string;
  applied: boolean;
  ambiguous?: boolean;
  redestinated_at?: string | null;
  // Indexed extra (carries the dotted v0.6 flag + any forward-compat keys).
  [extra: string]: string | number | boolean | null | undefined;
}

export interface WorkflowMatchRecord {
  template: string;
  cover_rate: number;
  no_match?: boolean;
}

export interface Ledger {
  version: number;
  analyzed: LedgerEntry[];
  workflow_match?: WorkflowMatchRecord;
  model: {
    fingerprint: string;
  };
}

export interface LedgerDiff {
  unchanged: LedgerEntry[];
  modified: { entry: LedgerEntry; new_scan: ScannedSkill }[];
  new_files: ScannedSkill[];
  removed: LedgerEntry[];
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function emptyLedger(modelFingerprint = "unknown"): Ledger {
  return {
    version: LEDGER_SCHEMA_VERSION,
    analyzed: [],
    model: { fingerprint: modelFingerprint },
  };
}

/**
 * Decide pending_v0.6_redestination based on classification — only role and
 * domain entries are subject to v0.6 receiver-side re-destination. Codebase-
 * fact stays in the repo and workflow lives at `<org>/workflows/` in both
 * versions.
 */
export function pendingV06ForLabel(label: ClassificationLabel): boolean {
  return label === "role" || label === "domain";
}

export function makeEntry(
  scanned: ScannedSkill,
  classification: ClassificationLabel,
  confidence: number,
  destination: string,
  opts: { ambiguous?: boolean; applied?: boolean } = {}
): LedgerEntry {
  const entry: LedgerEntry = {
    path: scanned.path,
    hash: scanned.hash,
    classification,
    confidence,
    destination,
    applied: opts.applied ?? false,
  };
  entry[PENDING_KEY] = pendingV06ForLabel(classification);
  if (opts.ambiguous) entry.ambiguous = true;
  return entry;
}

export function getPendingV06(entry: LedgerEntry): boolean {
  return entry[PENDING_KEY] === true;
}

export function setPendingV06(entry: LedgerEntry, value: boolean): void {
  entry[PENDING_KEY] = value;
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

export function loadLedger(ledgerPath: string): Ledger | null {
  if (!fs.existsSync(ledgerPath)) return null;
  const raw = normalizeLine(fs.readFileSync(ledgerPath, "utf-8"));
  const parsed = (yaml.load(raw) ?? {}) as Record<string, unknown>;
  if (typeof parsed.version !== "number") return null;
  const analyzedRaw = Array.isArray(parsed.analyzed) ? parsed.analyzed : [];
  const analyzed: LedgerEntry[] = [];
  for (const e of analyzedRaw) {
    if (!e || typeof e !== "object") continue;
    const v = e as Record<string, unknown>;
    if (
      typeof v.path !== "string" ||
      typeof v.hash !== "string" ||
      typeof v.classification !== "string"
    )
      continue;
    const label = v.classification as ClassificationLabel;
    const entry: LedgerEntry = {
      path: v.path,
      hash: v.hash,
      classification: label,
      confidence: typeof v.confidence === "number" ? v.confidence : 0,
      destination: typeof v.destination === "string" ? v.destination : "",
      applied: v.applied === true,
    };
    entry[PENDING_KEY] =
      typeof v[PENDING_KEY] === "boolean"
        ? (v[PENDING_KEY] as boolean)
        : pendingV06ForLabel(label);
    if (v.ambiguous === true) entry.ambiguous = true;
    if (typeof v.redestinated_at === "string") {
      entry.redestinated_at = v.redestinated_at;
    } else if (v.redestinated_at === null) {
      entry.redestinated_at = null;
    }
    analyzed.push(entry);
  }
  const workflow_match = parseWorkflowMatch(parsed.workflow_match);
  const model = parseModel(parsed.model);
  const out: Ledger = {
    version: parsed.version,
    analyzed,
    model,
  };
  if (workflow_match) out.workflow_match = workflow_match;
  return out;
}

function parseModel(raw: unknown): { fingerprint: string } {
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    if (typeof r.fingerprint === "string") return { fingerprint: r.fingerprint };
  }
  return { fingerprint: "unknown" };
}

function parseWorkflowMatch(raw: unknown): WorkflowMatchRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.template !== "string" || typeof r.cover_rate !== "number") {
    return undefined;
  }
  const out: WorkflowMatchRecord = {
    template: r.template,
    cover_rate: r.cover_rate,
  };
  if (r.no_match === true) out.no_match = true;
  return out;
}

export function saveLedger(ledgerPath: string, ledger: Ledger): void {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const text = yaml.dump(ledger, { lineWidth: -1 });
  fs.writeFileSync(ledgerPath, text, "utf-8");
}

// ---------------------------------------------------------------------------
// Diff against scan — drives "first run vs incremental" decision
// ---------------------------------------------------------------------------

export function diffAgainstScan(
  ledger: Ledger | null,
  scanned: ScannedSkill[]
): LedgerDiff {
  const diff: LedgerDiff = {
    unchanged: [],
    modified: [],
    new_files: [],
    removed: [],
  };
  if (!ledger) {
    diff.new_files = scanned.slice();
    return diff;
  }
  const byPath = new Map<string, LedgerEntry>();
  for (const e of ledger.analyzed) byPath.set(e.path, e);
  const seen = new Set<string>();
  for (const s of scanned) {
    seen.add(s.path);
    const existing = byPath.get(s.path);
    if (!existing) {
      diff.new_files.push(s);
    } else if (existing.hash !== s.hash) {
      diff.modified.push({ entry: existing, new_scan: s });
    } else {
      diff.unchanged.push(existing);
    }
  }
  for (const e of ledger.analyzed) {
    if (!seen.has(e.path)) diff.removed.push(e);
  }
  return diff;
}

/** Compose a fresh ledger from old + diff + new classifications. */
export function mergeLedger(
  previous: Ledger | null,
  diff: LedgerDiff,
  freshEntries: LedgerEntry[],
  modelFingerprint: string,
  opts: { prune_orphans?: boolean } = {}
): Ledger {
  const out: Ledger = {
    version: LEDGER_SCHEMA_VERSION,
    analyzed: [],
    model: { fingerprint: modelFingerprint },
  };
  if (previous?.workflow_match) out.workflow_match = previous.workflow_match;

  for (const u of diff.unchanged) out.analyzed.push(u);
  for (const f of freshEntries) out.analyzed.push(f);
  if (!opts.prune_orphans) {
    for (const r of diff.removed) out.analyzed.push(r);
  }
  out.analyzed.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
