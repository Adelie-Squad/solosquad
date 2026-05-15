import fs from "fs";
import path from "path";
import chalk from "chalk";
import { fileURLToPath } from "url";
import {
  readArchiveMeta,
  verifyArchive,
} from "../lifecycle/archive-reader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * v0.8.1 — `solosquad archive verify|info|list` CLIs.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §5. These commands work
 * on archives produced by v0.7+ `solosquad uninstall`. They share the
 * yauzl-based reader with `solosquad import`.
 */

export interface ArchiveVerifyOpts {
  json?: boolean;
}

export async function archiveVerifyCommand(
  archiveArg: string | undefined,
  opts: ArchiveVerifyOpts,
): Promise<void> {
  if (!archiveArg) {
    console.error(chalk.red("error: archive path is required"));
    process.exitCode = 2;
    return;
  }
  const archivePath = path.resolve(archiveArg);
  if (!fs.existsSync(archivePath)) {
    console.error(chalk.red(`error: archive not found at ${archivePath}`));
    process.exitCode = 2;
    return;
  }

  const cliVersion = readCliVersion();
  let report;
  try {
    report = await verifyArchive(archivePath, { cliVersion });
  } catch (e) {
    console.error(chalk.red(`\n✗ verify failed: ${(e as Error).message}`));
    process.exitCode = 1;
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
    return;
  }

  console.log(chalk.bold(`SoloSquad archive verify — ${archivePath}\n`));
  if (report.schemaCompat.ok) {
    console.log(chalk.green(`  ✓ schema_version=${report.schemaVersion} 호환`));
  } else {
    console.log(chalk.red(`  ✗ schema 호환 실패`));
    for (const r of report.schemaCompat.reasons) console.log(chalk.dim(`      - ${r}`));
  }
  console.log(`  • manifest entries : ${report.manifestRows}`);
  console.log(`  • archive entries  : ${report.archiveRows}`);

  if (report.shaMismatches.length === 0) {
    console.log(chalk.green(`  ✓ 모든 SHA256 manifest와 일치`));
  } else {
    console.log(chalk.red(`  ✗ ${report.shaMismatches.length} SHA mismatch(es)`));
    for (const m of report.shaMismatches.slice(0, 10)) {
      console.log(chalk.dim(`      - ${m.path}`));
      console.log(chalk.dim(`        manifest: ${m.manifest}`));
      console.log(chalk.dim(`        actual:   ${m.actual}`));
    }
    if (report.shaMismatches.length > 10) {
      console.log(chalk.dim(`      ... and ${report.shaMismatches.length - 10} more`));
    }
  }
  if (report.missingFromArchive.length > 0) {
    console.log(chalk.red(`  ✗ ${report.missingFromArchive.length} manifest entries missing from archive`));
    for (const p of report.missingFromArchive.slice(0, 5)) console.log(chalk.dim(`      - ${p}`));
  }
  if (report.extraInArchive.length > 0) {
    console.log(chalk.yellow(`  △ ${report.extraInArchive.length} archive entries NOT in manifest`));
    for (const p of report.extraInArchive.slice(0, 5)) console.log(chalk.dim(`      - ${p}`));
  }

  console.log("");
  if (report.ok) {
    console.log(chalk.green("✓ archive verified"));
  } else {
    console.log(chalk.red("✗ archive verify failed"));
    process.exitCode = 1;
  }
}

export async function archiveInfoCommand(archiveArg: string | undefined): Promise<void> {
  if (!archiveArg) {
    console.error(chalk.red("error: archive path is required"));
    process.exitCode = 2;
    return;
  }
  const archivePath = path.resolve(archiveArg);
  if (!fs.existsSync(archivePath)) {
    console.error(chalk.red(`error: archive not found at ${archivePath}`));
    process.exitCode = 2;
    return;
  }

  let meta;
  try {
    meta = await readArchiveMeta(archivePath);
  } catch (e) {
    console.error(chalk.red(`\n✗ info failed: ${(e as Error).message}`));
    process.exitCode = 1;
    return;
  }

  console.log(chalk.bold(`SoloSquad archive info — ${archivePath}\n`));
  console.log(`  export_ts         : ${meta.archiveYaml.export_ts}`);
  console.log(`  solosquad_version : ${meta.archiveYaml.solosquad_version}`);
  console.log(`  workspace_slug    : ${meta.archiveYaml.workspace_slug}`);
  console.log(`  archive_format    : ${meta.archiveYaml.archive_format}`);
  console.log(`  schema_version    : ${meta.archiveYaml.schema_version}`);
  console.log(`  included_orgs     : ${(meta.archiveYaml.included_orgs ?? []).join(", ") || "(none)"}`);
  console.log("");

  const byClass = new Map<string, { count: number; bytes: number }>();
  for (const m of meta.manifest.entries) {
    const e = byClass.get(m.cls) ?? { count: 0, bytes: 0 };
    e.count += 1;
    if (typeof m.size === "number") e.bytes += m.size;
    byClass.set(m.cls, e);
  }
  console.log(chalk.bold("Manifest summary:"));
  let totalCount = 0;
  let totalBytes = 0;
  for (const [cls, t] of Array.from(byClass.entries()).sort()) {
    console.log(`  ${cls.padEnd(4)} ${String(t.count).padStart(6)} entries, ${humanBytes(t.bytes)}`);
    totalCount += t.count;
    totalBytes += t.bytes;
  }
  console.log(`  Total ${String(totalCount).padStart(5)} entries, ${humanBytes(totalBytes)}`);
}

export interface ArchiveListOpts {
  class?: string;
}

export async function archiveListCommand(
  archiveArg: string | undefined,
  opts: ArchiveListOpts,
): Promise<void> {
  if (!archiveArg) {
    console.error(chalk.red("error: archive path is required"));
    process.exitCode = 2;
    return;
  }
  const archivePath = path.resolve(archiveArg);
  if (!fs.existsSync(archivePath)) {
    console.error(chalk.red(`error: archive not found at ${archivePath}`));
    process.exitCode = 2;
    return;
  }

  let meta;
  try {
    meta = await readArchiveMeta(archivePath);
  } catch (e) {
    console.error(chalk.red(`\n✗ list failed: ${(e as Error).message}`));
    process.exitCode = 1;
    return;
  }

  const filter = opts.class?.trim();
  for (const m of meta.manifest.entries) {
    if (filter && m.cls !== filter) continue;
    const sz = typeof m.size === "number" ? humanBytes(m.size).padStart(10) : "          ";
    console.log(`${m.cls.padEnd(4)} ${sz}  ${m.path}`);
  }
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function readCliVersion(): string {
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
