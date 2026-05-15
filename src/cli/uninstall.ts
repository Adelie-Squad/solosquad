import fs from "fs";
import os from "os";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { fileURLToPath } from "url";
import { classifyWorkspace, summarizeClassification } from "../lifecycle/classify.js";
import { extractRepoMeta } from "../lifecycle/repo-meta.js";
import { acquireLock, uninstallLockPath, LockHeldError } from "../lifecycle/lockfile.js";
import { JournalWriter, newRunId, journalPath } from "../lifecycle/journal.js";
import { precheck } from "../lifecycle/precheck.js";
import {
  collectRevokeData,
  renderManualRevokeFiles,
  renderRevokeChecklist,
} from "../lifecycle/revoke-checklist.js";
import { buildArchive } from "../lifecycle/archive.js";
import { backupSqlite, verifyBackup } from "../lifecycle/sqlite-backup.js";
import { runCleanup } from "../lifecycle/cleanup.js";
import { getWorkspaceRoot, getEnvPath } from "../util/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * v0.7 — `solosquad uninstall` orchestration.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §5.1 + §10 #9.
 *
 * Always archive first (no `--no-archive` flag). Cleanup gated on archive
 * existing and being verified. Class A (`repositories/<repo>/`) is never
 * touched — that contract is enforced by the classifier's traversal rules,
 * not by this command's logic.
 */

export interface UninstallOpts {
  dryRun?: boolean;
  archiveOnly?: boolean;
  keepWorkspace?: boolean;
  alsoPurgeBackups?: boolean;
  yes?: boolean;
  scrubContent?: boolean;
  force?: boolean;
  archivePath?: string;
}

export async function uninstallCommand(opts: UninstallOpts): Promise<void> {
  const workspace = getWorkspaceRoot();
  if (!fs.existsSync(path.join(workspace, ".solosquad"))) {
    console.log(chalk.red("✗ No SoloSquad workspace found at " + workspace));
    process.exit(1);
  }

  const workspaceSlug = path.basename(workspace);
  const archivePath = opts.archivePath ?? defaultArchivePath(workspaceSlug);
  const dryRun = Boolean(opts.dryRun);
  const archiveOnly = Boolean(opts.archiveOnly);
  const keepWorkspace = Boolean(opts.keepWorkspace);
  const alsoPurgeBackups = Boolean(opts.alsoPurgeBackups);
  const scrubContent = Boolean(opts.scrubContent);
  const force = Boolean(opts.force);

  console.log(chalk.bold(`\nSoloSquad uninstall — workspace: ${workspace}`));
  console.log(chalk.dim(`  Archive destination : ${archivePath}`));
  console.log(chalk.dim(`  Mode                : ${dryRun ? "DRY-RUN" : archiveOnly ? "ARCHIVE-ONLY" : keepWorkspace ? "ARCHIVE + KEEP-WORKSPACE" : "ARCHIVE + FULL CLEANUP"}`));

  // 0. Precheck
  const pre = await precheck({ workspace, archivePath, force });

  if (pre.protectedRepoPaths.length > 0) {
    console.log(chalk.green(`\n  ✓ The following paths will NOT be touched:`));
    for (const p of pre.protectedRepoPaths) console.log(`    - ${p}`);
  }

  for (const w of pre.warnings) console.log(chalk.yellow(`  ⚠ ${w}`));
  for (const b of pre.blockers) console.log(chalk.red(`  ✗ ${b}`));

  if (!pre.ok) {
    if (force) {
      console.log(chalk.yellow("\n  --force set — blockers overridden."));
    } else {
      console.log(chalk.red("\nResolve blockers above or rerun with --force. Aborting."));
      process.exit(1);
    }
  }

  console.log("");
  console.log(chalk.bold("Asset classification:"));
  for (const line of summarizeClassification(pre.existingLock ? classifyWorkspace(workspace) : classifyWorkspace(workspace))) {
    console.log("  " + line);
  }

  // Confirm prompt
  if (!opts.yes && !dryRun) {
    const { proceed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: archiveOnly
          ? "Create farewell archive? (cleanup skipped)"
          : keepWorkspace
            ? "Archive then partial cleanup (workflows/memory/knowledge kept on disk)?"
            : "Archive then full cleanup?",
        default: false,
      },
    ]);
    if (!proceed) {
      console.log(chalk.dim("Aborted by user."));
      process.exit(0);
    }
  }

  // Lock
  let lock;
  try {
    lock = acquireLock(uninstallLockPath(workspace));
  } catch (err) {
    if (err instanceof LockHeldError) {
      console.log(chalk.red(`\n✗ ${err.message}`));
      process.exit(1);
    }
    throw err;
  }

  const runId = newRunId();
  const journal = new JournalWriter(journalPath(workspace), runId);
  let archiveResult: Awaited<ReturnType<typeof buildArchive>> | null = null;

  try {
    // 1. Pre-archive: WAL-safe SQLite backup if v0.6 archive.sqlite exists
    const classification = classifyWorkspace(workspace);

    for (const e of classification.entries) {
      if (e.kind === "file" && e.relPath.endsWith("memory/archive.sqlite")) {
        const tmp = path.join(os.tmpdir(), `solosquad-archive-${runId}-${e.orgSlug}.sqlite`);
        try {
          journal.begin("archive.sqlite-backup", { org: e.orgSlug });
          if (!dryRun) {
            await backupSqlite(e.absPath, tmp);
            if (!verifyBackup(tmp)) {
              throw new Error(`SQLite backup integrity check failed for ${e.relPath}`);
            }
            // Replace the entry's absPath with the backup so archive uses
            // the consistent snapshot.
            e.absPath = tmp;
          }
          journal.end("archive.sqlite-backup", { org: e.orgSlug, dryRun });
        } catch (err) {
          journal.error("archive.sqlite-backup", { error: String(err) });
          throw err;
        }
      }
    }

    // 2. Extract A* repo metadata
    const extracted = extractRepoMeta(workspace);
    if (extracted.reposMissingRepoYaml.length > 0) {
      console.log(chalk.yellow(`\n  ⚠ ${extracted.reposMissingRepoYaml.length} repo(s) have .solosquad/ but no repo.yaml — their .solosquad/ will NOT be touched.`));
      for (const r of extracted.reposMissingRepoYaml) {
        console.log(`    - ${r.solosquadDir}`);
      }
    }

    // 3. Build revoke checklist
    const revokeData = collectRevokeData(workspace);
    const revokeChecklist = renderRevokeChecklist(revokeData);
    const manualRevokeFiles = renderManualRevokeFiles(revokeData);

    // Write the workspace-root copy of REVOKE-CHECKLIST.md
    if (!dryRun) {
      fs.writeFileSync(path.join(workspace, "REVOKE-CHECKLIST.md"), revokeChecklist);
    }

    // 4. Build archive
    const envPath = path.join(workspace, ".solosquad", ".env");
    const envText = fs.existsSync(envPath)
      ? fs.readFileSync(envPath, "utf-8")
      : fs.existsSync(getEnvPath(workspace))
        ? fs.readFileSync(getEnvPath(workspace), "utf-8")
        : null;

    const solosquadVersion = readPackageVersion();

    if (!dryRun) {
      archiveResult = await buildArchive({
        workspace,
        workspaceSlug,
        archivePath,
        classification,
        extractedRepos: extracted.extractions,
        envText,
        revokeChecklist,
        manualRevokeFiles,
        solosquadVersion,
        scrubContent,
        journal,
      });
      console.log(chalk.green(`\n  ✓ Archive written: ${archivePath} (${humanBytes(archiveResult.size)}, ${archiveResult.manifestRows} entries)`));
      if (archiveResult.redactedSecretKeys.length > 0) {
        console.log(chalk.dim(`    Redacted secret keys: ${archiveResult.redactedSecretKeys.join(", ")}`));
      }
      if (scrubContent && archiveResult.scrubReport.length > 0) {
        const total = archiveResult.scrubReport.reduce((s, m) => s + m.count, 0);
        console.log(chalk.dim(`    PII scrub: ${total} match(es) across ${archiveResult.scrubReport.length} file(s)`));
      }
    } else {
      console.log(chalk.dim(`\n  (dry-run) Archive NOT written. Would have included ~${classification.entries.length} entries.`));
    }

    // 5. Cleanup (unless --archive-only)
    if (!archiveOnly) {
      const report = await runCleanup({
        workspace,
        classification,
        extractedRepos: extracted.extractions,
        reposMissingRepoYaml: extracted.reposMissingRepoYaml,
        journal,
        dryRun,
        keepWorkspace,
        alsoPurgeBackups,
      });
      console.log(chalk.green(`\n  ✓ Cleanup: removed=${report.removed.length} preserved=${report.preserved.length} archivedSessions=${report.archivedSessions.length} skipped=${report.skipped.length}`));
      for (const a of report.assertions) {
        if (!a.passed) {
          console.log(chalk.red(`    ✗ ${a.repoPath}: ${a.reason}`));
        }
      }

      // Move journal into archive (best-effort)
      if (!dryRun && archiveResult) {
        // We can't re-open the zip with archiver; leave journal in place
        // for now and remove it explicitly once we know cleanup succeeded.
        try {
          fs.unlinkSync(journalPath(workspace));
        } catch {
          // ignore
        }
      }
    } else {
      console.log(chalk.dim("\n  --archive-only: cleanup skipped."));
    }

    // 6. Done — final guidance
    console.log("");
    console.log(chalk.bold("Next steps:"));
    console.log(`  1. Review ${path.join(workspace, "REVOKE-CHECKLIST.md")} for external resources to revoke`);
    console.log(`  2. Verify archive at ${archivePath}`);
    if (!archiveOnly) {
      console.log(`  3. (Optional) npm uninstall -g solosquad`);
    }
    console.log("");
  } finally {
    lock.release();
  }
}

function defaultArchivePath(workspaceSlug: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  return path.join(os.homedir(), `solosquad-archive-${workspaceSlug}-${ts}.zip`);
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function readPackageVersion(): string {
  let pkgPath = path.resolve(__dirname, "..", "..", "package.json");
  if (!fs.existsSync(pkgPath)) {
    pkgPath = path.resolve(__dirname, "..", "..", "..", "package.json");
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
