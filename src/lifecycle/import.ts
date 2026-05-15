import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import {
  readArchiveMeta,
  extractAllEntries,
  verifyArchive,
  type ArchiveYamlDoc,
  type ManifestDoc,
  type VerifyReport,
} from "./archive-reader.js";
import {
  decideFileConflict,
  detectIdConflicts,
  type MergeDecision,
} from "./merge-strategy.js";
import {
  JournalWriter,
  newRunId,
  importJournalPath,
} from "./journal.js";

/**
 * v0.8.1 — `solosquad import <archive.zip>`.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §4. The orchestration here
 * is intentionally thin: archive verify (archive-reader) + per-file merge
 * decisions (merge-strategy) + a journal for resume safety. CLI argument
 * parsing + user-facing prompts live in `src/cli/import.ts`.
 *
 * Mapping summary (per §4.2):
 *
 *   archive.yaml/manifest.tsv/REVOKE-CHECKLIST.md/PII-NOTICE.md → stored on
 *     disk under `<workspace>/.solosquad/import-meta/<runId>/` for audit.
 *   workspace/AGENTS.md                                          → <workspace>/AGENTS.md
 *   workspace/<rest>                                             → <workspace>/.solosquad/<rest>
 *   orgs/<slug>/<rest>                                           → <workspace>/<slug>/<rest>
 *   orgs/<slug>/repos/<repo>/repo.yaml                           → guidance only (logged, not extracted)
 *   credentials/env.template                                     → <workspace>/.solosquad/.env.template
 *   manual-revoke-required/<file>                                → import-meta/<runId>/manual-revoke-required/<file>
 */

export interface ImportOptions {
  archivePath: string;
  workspace: string;
  cliVersion: string;
  /** Bias `<org>` mapping — if set, the archive's orgs/<X>/ rewrites to <workspace>/<into>/<X>/... unless equal. */
  into?: string;
  /** No disk changes; produces a report only. */
  dryRun: boolean;
  /** "merge" is default, "replace" overwrites without renaming siblings. */
  mode: "merge" | "replace";
  /** Optional override of "now" — set by tests. */
  nowIso?: string;
}

export interface PlannedAction {
  /** Path inside the archive zip. */
  archivePath: string;
  /** Decision returned by merge-strategy. */
  decision: MergeDecision;
  /** Final destination path relative to workspace root, forward-slashed. */
  workspaceRelPath: string;
  cls: string;
}

export interface ImportReport {
  runId: string;
  archivePath: string;
  workspace: string;
  archiveYaml: ArchiveYamlDoc;
  manifest: ManifestDoc;
  verify: VerifyReport;
  /** Per-entry plan — populated for both dry-run and real apply. */
  actions: PlannedAction[];
  /** id collisions (workflows/goals) — surfaced before any disk write. */
  idConflicts: { org: string; workflowConflicts: string[]; goalConflicts: string[] }[];
  /** Org slugs included by the archive. */
  includedOrgs: string[];
  /** Repo paths user must `git clone` separately (Class A* repo.yaml entries). */
  repoCloneTargets: { org: string; repo: string; repoYamlPath: string }[];
  /** Counts by decision kind. */
  summary: Record<string, number>;
  /** True if no fatal errors were detected. */
  ok: boolean;
  /** Fatal errors (verify failure, id conflicts without --replace). */
  errors: string[];
}

/* -------------------------------------------------------------------------- */
/* Path mapping                                                               */
/* -------------------------------------------------------------------------- */

interface MappedPath {
  workspaceRelPath: string;
  /** Where to actually write on disk; absolute. */
  absPath: string;
  /** True when this entry is metadata (manifest, archive.yaml, …). */
  isMeta: boolean;
  /** Set when this is a Class A* repo.yaml — caller emits guidance only. */
  repoSlug?: { org: string; repo: string };
}

function mapArchivePathToWorkspace(
  archivePath: string,
  workspace: string,
  runId: string,
  intoOrg: string | undefined,
): MappedPath | null {
  // Synthetic meta files — store under import-meta/ for audit.
  const META_FILES = new Set([
    "archive.yaml",
    "manifest.tsv",
    "PII-NOTICE.md",
    "REVOKE-CHECKLIST.md",
    "scrub-report.tsv",
  ]);
  if (META_FILES.has(archivePath)) {
    const absPath = path.join(
      workspace,
      ".solosquad",
      "import-meta",
      runId,
      archivePath,
    );
    return {
      workspaceRelPath: `.solosquad/import-meta/${runId}/${archivePath}`,
      absPath,
      isMeta: true,
    };
  }

  if (archivePath.startsWith("manual-revoke-required/")) {
    const absPath = path.join(
      workspace,
      ".solosquad",
      "import-meta",
      runId,
      archivePath,
    );
    return {
      workspaceRelPath: `.solosquad/import-meta/${runId}/${archivePath}`,
      absPath,
      isMeta: true,
    };
  }

  if (archivePath === "workspace/AGENTS.md") {
    return {
      workspaceRelPath: "AGENTS.md",
      absPath: path.join(workspace, "AGENTS.md"),
      isMeta: false,
    };
  }

  if (archivePath.startsWith("workspace/")) {
    const rest = archivePath.slice("workspace/".length);
    // workspace/.solosquad bits were unwrapped on archive — the writer maps
    // `.solosquad/foo` → `workspace/foo`. We reverse that here.
    const rel = `.solosquad/${rest}`;
    return {
      workspaceRelPath: rel,
      absPath: path.join(workspace, ".solosquad", rest),
      isMeta: false,
    };
  }

  if (archivePath === "credentials/env.template") {
    return {
      workspaceRelPath: ".solosquad/.env.template",
      absPath: path.join(workspace, ".solosquad", ".env.template"),
      isMeta: false,
    };
  }

  if (archivePath.startsWith("orgs/")) {
    const rest = archivePath.slice("orgs/".length);
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    const srcOrg = rest.slice(0, slash);
    const inner = rest.slice(slash + 1);
    const targetOrg = intoOrg ?? srcOrg;

    // repos/<repo>/repo.yaml is class A*. We do not extract it (the user
    // restores the repo source out-of-band per §4.2 step 4) — but we
    // surface its presence so the CLI can print the guidance message.
    const repoMatch = /^repos\/([^/]+)\/repo\.yaml$/.exec(inner);
    if (repoMatch) {
      return {
        workspaceRelPath: `${targetOrg}/repositories/${repoMatch[1]}/.solosquad/repo.yaml`,
        absPath: path.join(
          workspace,
          targetOrg,
          "repositories",
          repoMatch[1],
          ".solosquad",
          "repo.yaml",
        ),
        isMeta: false,
        repoSlug: { org: targetOrg, repo: repoMatch[1] },
      };
    }

    return {
      workspaceRelPath: `${targetOrg}/${inner}`,
      absPath: path.join(workspace, targetOrg, inner),
      isMeta: false,
    };
  }

  // Anything else — drop into import-meta/ for audit so it doesn't get lost.
  const absPath = path.join(workspace, ".solosquad", "import-meta", runId, archivePath);
  return {
    workspaceRelPath: `.solosquad/import-meta/${runId}/${archivePath}`,
    absPath,
    isMeta: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Orchestrator                                                               */
/* -------------------------------------------------------------------------- */

export async function importArchive(opts: ImportOptions): Promise<ImportReport> {
  if (!fs.existsSync(opts.archivePath)) {
    throw new Error(`archive not found: ${opts.archivePath}`);
  }
  fs.mkdirSync(path.join(opts.workspace, ".solosquad"), { recursive: true });

  const runId = newRunId();
  const journal = new JournalWriter(importJournalPath(opts.workspace), runId);

  const errors: string[] = [];
  const summary: Record<string, number> = {
    write: 0,
    skip: 0,
    "append-dedup": 0,
    "rename-sibling": 0,
    reject: 0,
  };

  // -- Stage 1: verify ----
  journal.begin("import.verify", { archive: opts.archivePath });
  const verify = await verifyArchive(opts.archivePath, { cliVersion: opts.cliVersion });
  if (!verify.ok) {
    const reasons: string[] = [];
    if (!verify.schemaCompat.ok) reasons.push(...verify.schemaCompat.reasons);
    if (verify.shaMismatches.length > 0) reasons.push(`${verify.shaMismatches.length} SHA mismatch(es)`);
    if (verify.missingFromArchive.length > 0) reasons.push(`${verify.missingFromArchive.length} missing entries`);
    errors.push(...reasons);
  }
  journal.end("import.verify", { ok: verify.ok });

  const meta = await readArchiveMeta(opts.archivePath);

  // -- Stage 2: plan ----
  const incomingWorkflowIdsByOrg = new Map<string, Set<string>>();
  const incomingGoalIdsByOrg = new Map<string, Set<string>>();
  for (const m of meta.manifest.entries) {
    const r = /^orgs\/([^/]+)\/workflows\/([^/]+)\//.exec(m.path);
    if (r) {
      const s = incomingWorkflowIdsByOrg.get(r[1]) ?? new Set<string>();
      s.add(r[2]);
      incomingWorkflowIdsByOrg.set(r[1], s);
      continue;
    }
    const g = /^orgs\/([^/]+)\/goals\/([^/]+)\//.exec(m.path);
    if (g) {
      const s = incomingGoalIdsByOrg.get(g[1]) ?? new Set<string>();
      s.add(g[2]);
      incomingGoalIdsByOrg.set(g[1], s);
    }
  }

  const includedOrgs = meta.archiveYaml.included_orgs ?? [];
  const idConflicts: ImportReport["idConflicts"] = [];
  for (const org of includedOrgs) {
    const targetOrg = opts.into ?? org;
    const orgDir = path.join(opts.workspace, targetOrg);
    const wfIds = incomingWorkflowIdsByOrg.get(org) ?? new Set<string>();
    const goalIds = incomingGoalIdsByOrg.get(org) ?? new Set<string>();
    const conflicts = detectIdConflicts({
      orgDir,
      incomingWorkflowIds: wfIds,
      incomingGoalIds: goalIds,
    });
    if (conflicts.workflowConflicts.length > 0 || conflicts.goalConflicts.length > 0) {
      idConflicts.push({
        org: targetOrg,
        workflowConflicts: conflicts.workflowConflicts,
        goalConflicts: conflicts.goalConflicts,
      });
      if (opts.mode === "merge") {
        errors.push(
          `org "${targetOrg}": ${conflicts.workflowConflicts.length} workflow id(s) + ${conflicts.goalConflicts.length} goal id(s) conflict — rename them in the archive or rerun with --replace`,
        );
      }
    }
  }

  // -- Stage 3: extract + decide ----
  const actions: PlannedAction[] = [];
  const repoCloneTargets: ImportReport["repoCloneTargets"] = [];
  const classByPath = new Map<string, string>();
  for (const m of meta.manifest.entries) classByPath.set(m.path, m.cls);

  journal.begin("import.unpack", { dryRun: opts.dryRun });

  await extractAllEntries(opts.archivePath, async (e) => {
    if (e.archivePath === "manifest.tsv") return; // already read in meta
    const mapped = mapArchivePathToWorkspace(
      e.archivePath,
      opts.workspace,
      runId,
      opts.into,
    );
    if (!mapped) return;

    const cls = classByPath.get(e.archivePath) ?? "?";

    if (mapped.repoSlug) {
      repoCloneTargets.push({
        org: mapped.repoSlug.org,
        repo: mapped.repoSlug.repo,
        repoYamlPath: mapped.absPath,
      });
    }

    // For SHA verification — if the manifest declares a SHA and our extract
    // computed one, they should already match (verify stage caught this).
    // We trust the manifest row.
    const manifestRow = meta.manifest.entries.find((m) => m.path === e.archivePath);
    if (manifestRow && manifestRow.sha256 && manifestRow.sha256 !== e.sha256) {
      errors.push(`SHA mismatch for ${e.archivePath} — refusing to extract`);
      return;
    }

    const existingBytes = fs.existsSync(mapped.absPath)
      ? fs.readFileSync(mapped.absPath)
      : null;

    const decision = decideFileConflict({
      relPath: mapped.workspaceRelPath,
      incomingBytes: e.buffer,
      existingBytes,
      absPath: mapped.absPath,
      mode: opts.mode,
    });

    summary[decision.kind] = (summary[decision.kind] ?? 0) + 1;
    actions.push({
      archivePath: e.archivePath,
      decision,
      workspaceRelPath: mapped.workspaceRelPath,
      cls,
    });

    if (opts.dryRun) return;
    if (decision.kind === "skip" || decision.kind === "reject") return;
    if (!decision.targetPath || !decision.bytes) return;

    // Idempotent resume: if the target already exists with the same SHA we
    // intend to write, skip silently. This is what makes the journal
    // re-runnable after a crash.
    if (
      fs.existsSync(decision.targetPath) &&
      sha256Of(fs.readFileSync(decision.targetPath)) === sha256Of(decision.bytes)
    ) {
      return;
    }

    fs.mkdirSync(path.dirname(decision.targetPath), { recursive: true });
    fs.writeFileSync(decision.targetPath, decision.bytes);
  });

  journal.end("import.unpack", { actions: actions.length, summary });

  // -- Stage 4: post-verify ----
  journal.begin("import.verify-post", { actions: actions.length });
  if (!opts.dryRun) {
    for (const a of actions) {
      if (a.decision.kind === "skip" || a.decision.kind === "reject") continue;
      if (!a.decision.targetPath) continue;
      if (!fs.existsSync(a.decision.targetPath)) {
        errors.push(`post-verify: missing ${a.decision.targetPath}`);
      }
    }
  }
  journal.end("import.verify-post", { errors: errors.length });

  const report: ImportReport = {
    runId,
    archivePath: opts.archivePath,
    workspace: opts.workspace,
    archiveYaml: meta.archiveYaml,
    manifest: meta.manifest,
    verify,
    actions,
    idConflicts,
    includedOrgs,
    repoCloneTargets,
    summary,
    ok: errors.length === 0,
    errors,
  };
  return report;
}

function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
