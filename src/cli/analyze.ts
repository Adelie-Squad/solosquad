import fs from "fs";
import path from "path";
import chalk from "chalk";
import {
  scanRepoSkills,
  readScannedBody,
  type ScannedSkill,
} from "../analyze/scanner.js";
import {
  loadLedger,
  saveLedger,
  diffAgainstScan,
  mergeLedger,
  makeEntry,
  emptyLedger,
  LEDGER_REL_PATH,
  type ClassificationLabel,
  type LedgerEntry,
} from "../analyze/ledger.js";
import {
  classifyBatch,
  createHeuristicCaller,
  type ClassifierCaller,
  type Classification,
} from "../analyze/classifier.js";
import { matchWorkflow } from "../analyze/workflow-matcher.js";
import {
  renderReport,
  defaultReportPath,
  writeReport,
} from "../analyze/report-writer.js";

/**
 * v0.5 §6 — `solosquad analyze repo <path>` entry point.
 *
 * Flow: scan → diff ledger → classify only new/modified → merge → workflow
 * match → render Markdown report → persist.
 *
 * `--force` re-classifies everything (model upgrade). `--prune-orphans`
 * drops ledger entries whose files vanished. The injected `caller` is
 * how the test harness asserts "second run makes 0 LLM calls" (§11.3).
 */

export interface AnalyzeRepoOpts {
  force?: boolean;
  prune_orphans?: boolean;
  caller?: ClassifierCaller;
  /** Override model fingerprint label (test determinism). */
  model_fingerprint?: string;
  /** Override now() — for deterministic report filenames in tests. */
  now?: () => Date;
  /** Don't render to disk, return the result only. */
  in_memory?: boolean;
}

export interface AnalyzeResult {
  repo_root: string;
  ledger_path: string;
  report_path?: string;
  report_body: string;
  scanned_count: number;
  classified_count: number;
  caller_calls: number;
  no_match: boolean;
  best_template?: string;
}

export async function analyzeRepoCommand(
  repoInput: string,
  opts: AnalyzeRepoOpts = {}
): Promise<AnalyzeResult> {
  const repoRoot = path.resolve(repoInput);
  if (!fs.existsSync(repoRoot)) {
    throw new Error(`repo path does not exist: ${repoRoot}`);
  }
  const ledgerPath = path.join(repoRoot, LEDGER_REL_PATH);
  const modelFingerprint = opts.model_fingerprint ?? "heuristic-v1";
  const caller = opts.caller ?? createHeuristicCaller();
  const now = opts.now ?? (() => new Date());

  const scanned = scanRepoSkills(repoRoot);
  const previous = loadLedger(ledgerPath);
  const diff = diffAgainstScan(opts.force ? null : previous, scanned);

  // The bodies we feed the classifier are the *current* file contents on
  // disk for new + modified entries. Unchanged entries skip the LLM.
  const toClassify: { scanned: ScannedSkill; body: string }[] = [];
  for (const s of diff.new_files) {
    toClassify.push({ scanned: s, body: readScannedBody(repoRoot, s) });
  }
  for (const m of diff.modified) {
    toClassify.push({ scanned: m.new_scan, body: readScannedBody(repoRoot, m.new_scan) });
  }

  const classifications: Classification[] = await classifyBatch(
    toClassify.map((t) => ({ path: t.scanned.path, body: t.body })),
    { caller }
  );

  // Build fresh ledger entries from classifications.
  const freshEntries: LedgerEntry[] = [];
  const byPath = new Map<string, { scanned: ScannedSkill; body: string }>();
  for (const t of toClassify) byPath.set(t.scanned.path, t);
  for (const cls of classifications) {
    const t = byPath.get(cls.path);
    if (!t) continue;
    const dest = humanReadableDestination(cls.label);
    freshEntries.push(
      makeEntry(t.scanned, cls.label, cls.confidence, dest, {
        ambiguous: cls.ambiguous,
      })
    );
  }

  const merged = mergeLedger(
    opts.force ? emptyLedger(modelFingerprint) : previous,
    diff,
    freshEntries,
    modelFingerprint,
    { prune_orphans: opts.prune_orphans }
  );

  // Bodies map for workflow matching — includes both newly classified and
  // (for cached entries) reloaded from disk so cover_rate considers them.
  const bodies = new Map<string, string>();
  for (const t of toClassify) bodies.set(t.scanned.path, t.body);
  for (const u of diff.unchanged) {
    try {
      bodies.set(
        u.path,
        fs.readFileSync(
          path.join(repoRoot, u.path.split("/").join(path.sep)),
          "utf-8"
        )
      );
    } catch {
      /* file may have permissions issues — skip */
    }
  }

  // For workflow matching we need a Classification list covering *every*
  // ledger entry (including cached ones from previous runs).
  const allCls: Classification[] = [];
  for (const u of diff.unchanged) {
    allCls.push({
      path: u.path,
      label: u.classification,
      confidence: u.confidence,
      ambiguous: u.ambiguous === true,
      raw: [{ label: u.classification, confidence: u.confidence }],
    });
  }
  for (const c of classifications) allCls.push(c);

  const wf = matchWorkflow(allCls, bodies);
  if (wf.best) {
    merged.workflow_match = {
      template: wf.best.template,
      cover_rate: wf.best.cover_rate,
      no_match: wf.no_match,
    };
  }

  const generatedAt = now();
  const reportBody = renderReport({
    repo_label: path.basename(repoRoot),
    ledger: merged,
    classifications: allCls,
    workflow_match: wf,
    scan_summary: {
      total_files: scanned.length,
      new_files: diff.new_files.length,
      modified_files: diff.modified.length,
      unchanged_files: diff.unchanged.length,
      removed_files: diff.removed.length,
    },
    generated_at: generatedAt.toISOString(),
  });

  const result: AnalyzeResult = {
    repo_root: repoRoot,
    ledger_path: ledgerPath,
    report_body: reportBody,
    scanned_count: scanned.length,
    classified_count: classifications.length,
    caller_calls: caller.call_count ?? 0,
    no_match: wf.no_match,
  };
  if (wf.best) result.best_template = wf.best.template;

  if (!opts.in_memory) {
    saveLedger(ledgerPath, merged);
    const reportPath = defaultReportPath(
      repoRoot,
      generatedAt,
      `analyze-${path.basename(repoRoot)}`
    );
    writeReport(reportPath, reportBody);
    result.report_path = reportPath;
  }

  return result;
}

function humanReadableDestination(label: ClassificationLabel): string {
  switch (label) {
    case "codebase-fact":
      return "repo (stay)";
    case "role":
      return "~/.solosquad/agents/{team}/{agent}/SKILL.md (v0.5 temp)";
    case "workflow":
      return "<org>/workflows/";
    case "domain":
      return "<org>/memory/domain/ (v0.5 temp)";
  }
}

/** Pretty-printing wrapper for the CLI surface. */
export async function analyzeRepoCli(
  repoInput: string,
  opts: { force?: boolean; pruneOrphans?: boolean }
): Promise<void> {
  const repoRoot = path.resolve(repoInput);
  console.log(chalk.cyan(`Analyzing ${repoRoot} ...`));
  const result = await analyzeRepoCommand(repoRoot, {
    force: opts.force,
    prune_orphans: opts.pruneOrphans,
  });
  console.log(chalk.dim(`Scanned ${result.scanned_count} skill files`));
  console.log(
    chalk.dim(
      `Classified ${result.classified_count} (caller calls: ${result.caller_calls})`
    )
  );
  if (result.best_template) {
    console.log(
      chalk.green(
        `Best workflow match: ${result.best_template}${result.no_match ? " (below 0.5 threshold)" : ""}`
      )
    );
  } else {
    console.log(chalk.yellow("No workflow match — recommend custom workflow."));
  }
  if (result.report_path) {
    console.log(chalk.green(`Report: ${result.report_path}`));
  }
  console.log(chalk.green(`Ledger: ${result.ledger_path}`));
}
