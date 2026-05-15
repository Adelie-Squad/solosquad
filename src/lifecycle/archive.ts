import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import archiver from "archiver";
import type { ClassifyResult, AssetEntry } from "./classify.js";
import type { RepoMetaExtraction } from "./repo-meta.js";
import { ManifestBuilder, sha256OfBuffer } from "./manifest.js";
import { maskEnvContent, type MaskResult } from "../util/secrets.js";
import type { JournalWriter } from "./journal.js";

/**
 * v0.7 — Farewell archive writer.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §6 + §10 #5 + P0/P1.
 *
 * Streaming zip via `archiver` — SHA256 is computed on the fly using a
 * hash tap, so we never re-open the finished zip. Manifest rows are
 * accumulated and written at the end.
 *
 * Layout:
 *   archive.yaml
 *   manifest.tsv
 *   PII-NOTICE.md
 *   REVOKE-CHECKLIST.md
 *   workspace/...                  (class B workspace-level)
 *   orgs/<org>/...                 (class B/C org-level)
 *   orgs/<org>/repos/<repo>/...    (class A* surgical)
 *   credentials/env.template       (class D masked)
 *   manual-revoke-required/...     (stand-alone revoke pages)
 */

const ARCHIVE_SCHEMA_VERSION = 1 as const;
const ARCHIVE_FORMAT = "zip-v1" as const;

export interface ArchiveOptions {
  workspace: string;
  workspaceSlug: string;
  archivePath: string;
  classification: ClassifyResult;
  extractedRepos: RepoMetaExtraction[];
  /** Raw `.env` text, or `null` if no .env exists. */
  envText: string | null;
  /** Markdown text for `REVOKE-CHECKLIST.md`. */
  revokeChecklist: string;
  /** Optional per-section revoke files for `manual-revoke-required/`. */
  manualRevokeFiles: Map<string, string>;
  /** Version string for `archive.yaml` (use package.json version). */
  solosquadVersion: string;
  journal: JournalWriter;
  /** ISO timestamp for export_ts; defaults to now. */
  nowIso?: string;
}

export interface ArchiveResult {
  path: string;
  size: number;
  manifestRows: number;
  redactedSecretKeys: string[];
}

export async function buildArchive(opts: ArchiveOptions): Promise<ArchiveResult> {
  fs.mkdirSync(path.dirname(opts.archivePath), { recursive: true });
  const nowIso = opts.nowIso ?? new Date().toISOString();

  const out = fs.createWriteStream(opts.archivePath);
  const zip = archiver("zip", { zlib: { level: 6 }, store: false });
  zip.pipe(out);

  const manifest = new ManifestBuilder();
  let redactedSecretKeys: string[] = [];

  const closed = new Promise<void>((resolve, reject) => {
    out.on("close", () => resolve());
    out.on("error", reject);
    zip.on("warning", (err: Error & { code?: string }) => {
      if (err.code === "ENOENT") {
        return; // skipped file — non-fatal
      }
      reject(err);
    });
    zip.on("error", reject);
  });

  opts.journal.begin("archive");

  // --- 1) Class B + C content ---
  for (const entry of opts.classification.entries) {
    if (entry.cls === "A" || entry.cls === "A*" || entry.cls === "E") continue;
    if (entry.kind === "directory") continue;
    if (entry.cls === "D") continue; // handled below as masked
    if (!fs.existsSync(entry.absPath)) continue;

    const archiveRel = mapAssetToArchivePath(entry);
    if (!archiveRel) continue;
    addFile(entry.absPath, archiveRel, entry.cls, zip, manifest);
  }

  // --- 2) Class A* surgical extracts ---
  for (const repo of opts.extractedRepos) {
    addBuffer(
      Buffer.from(repo.contents, "utf-8"),
      repo.archivePath,
      "A*",
      zip,
      manifest,
    );
  }

  // --- 3) Class D masked credentials ---
  if (opts.envText) {
    const mask: MaskResult = maskEnvContent(opts.envText, { nowIso });
    redactedSecretKeys = mask.redactedKeys;
    addBuffer(
      Buffer.from(mask.masked, "utf-8"),
      "credentials/env.template",
      "D",
      zip,
      manifest,
      "values redacted",
    );
  }

  // --- 4) REVOKE-CHECKLIST.md + manual-revoke-required/ ---
  addBuffer(Buffer.from(opts.revokeChecklist, "utf-8"), "REVOKE-CHECKLIST.md", "C", zip, manifest);
  for (const [archiveRel, body] of opts.manualRevokeFiles) {
    addBuffer(Buffer.from(body, "utf-8"), archiveRel, "C", zip, manifest);
  }

  // --- 5) PII-NOTICE.md ---
  const piiNotice = renderPiiNotice();
  addBuffer(Buffer.from(piiNotice, "utf-8"), "PII-NOTICE.md", "C", zip, manifest);

  // --- 6) archive.yaml (depends on counts) ---
  const archiveYaml = renderArchiveYaml({
    schemaVersion: ARCHIVE_SCHEMA_VERSION,
    exportTs: nowIso,
    solosquadVersion: opts.solosquadVersion,
    workspaceSlug: opts.workspaceSlug,
    createdBy: "solosquad uninstall",
    includedOrgs: collectOrgSlugs(opts.classification),
    archiveFormat: ARCHIVE_FORMAT,
  });
  addBuffer(Buffer.from(archiveYaml, "utf-8"), "archive.yaml", "C", zip, manifest);

  // --- 7) manifest.tsv last (so it lists all entries) ---
  const manifestText = manifest.toTsv();
  // We cannot easily list manifest.tsv inside itself, so the manifest does
  // not contain a row for itself. That's per §6.2 — manifest tracks the
  // *contents* of the archive other than the manifest itself.
  zip.append(manifestText, { name: "manifest.tsv" });

  await zip.finalize();
  await closed;

  const stat = fs.statSync(opts.archivePath);
  opts.journal.end("archive", { archive_path: opts.archivePath, bytes: stat.size });

  return {
    path: opts.archivePath,
    size: stat.size,
    manifestRows: manifest.size(),
    redactedSecretKeys,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function addFile(
  absPath: string,
  archiveRel: string,
  cls: string,
  zip: archiver.Archiver,
  manifest: ManifestBuilder,
): void {
  const buf = fs.readFileSync(absPath);
  zip.append(buf, { name: archiveRel });
  manifest.add({
    path: archiveRel,
    sha256: sha256OfBuffer(buf),
    size: buf.byteLength,
    cls,
    notes: archiveRel.endsWith("archive.sqlite") ? "wal-safe-backup" : undefined,
  });
}

function addBuffer(
  buf: Buffer,
  archiveRel: string,
  cls: string,
  zip: archiver.Archiver,
  manifest: ManifestBuilder,
  notes?: string,
): void {
  zip.append(buf, { name: archiveRel });
  manifest.add({
    path: archiveRel,
    sha256: cls === "D" ? null : sha256OfBuffer(buf),
    size: buf.byteLength,
    cls,
    notes,
  });
}

function mapAssetToArchivePath(entry: AssetEntry): string | null {
  if (entry.cls === "A" || entry.cls === "A*" || entry.cls === "E") return null;

  const rel = entry.relPath;
  if (entry.orgSlug) {
    // strip leading "<orgSlug>/" — rel might be "myorg/memory/foo.jsonl"
    const stripped = rel.startsWith(entry.orgSlug + "/") ? rel.slice(entry.orgSlug.length + 1) : rel;
    return `orgs/${entry.orgSlug}/${stripped}`;
  }

  // Workspace-level: route .solosquad/* into workspace/ and AGENTS.md into workspace/
  if (rel === "AGENTS.md") return "workspace/AGENTS.md";
  if (rel.startsWith(".solosquad/")) return `workspace/${rel.slice(".solosquad/".length)}`;
  if (rel.startsWith("knowledge/")) return `workspace/${rel}`;
  return `workspace/${rel}`;
}

function collectOrgSlugs(c: ClassifyResult): string[] {
  const set = new Set<string>();
  for (const e of c.entries) {
    if (e.orgSlug) set.add(e.orgSlug);
  }
  return Array.from(set).sort();
}

interface ArchiveYamlDoc {
  schemaVersion: number;
  exportTs: string;
  solosquadVersion: string;
  workspaceSlug: string;
  createdBy: string;
  includedOrgs: string[];
  archiveFormat: typeof ARCHIVE_FORMAT;
}

function renderArchiveYaml(d: ArchiveYamlDoc): string {
  const doc = {
    schema_version: d.schemaVersion,
    export_ts: d.exportTs,
    solosquad_version: d.solosquadVersion,
    workspace_slug: d.workspaceSlug,
    created_by: d.createdBy,
    included_orgs: d.includedOrgs,
    excluded: [
      "<workspace>/<org>/repositories/",
      "~/.claude/projects/",
      ".env actual values",
    ],
    manifest_path: "manifest.tsv",
    revoke_checklist_path: "REVOKE-CHECKLIST.md",
    import_compat: {
      min_solosquad_version: "0.7.0",
      max_schema_version_supported: 1,
      archive_format: d.archiveFormat,
    },
  };
  return yaml.dump(doc, { lineWidth: 100 });
}

function renderPiiNotice(): string {
  const lines: string[] = [];
  lines.push("# PII Notice — Farewell Archive");
  lines.push("");
  lines.push("이 archive에는 다음과 같은 **본문 평문 데이터**가 포함될 수 있습니다:");
  lines.push("");
  lines.push("- `orgs/*/workflows/<id>/_events.jsonl` — 사용자 메시지·LLM 응답·도구 호출 인자");
  lines.push("- `orgs/*/memory/routine-logs/*.jsonl` — routine 결과 전문");
  lines.push("- `orgs/*/memory/pm-skills/*.md` — PM compaction 결과");
  lines.push("- `orgs/*/workflows/<id>/stage-N-*/` — stage 산출물");
  lines.push("- `workspace/AGENTS.md` — 사용자가 손으로 적은 워크스페이스 가이드");
  lines.push("");
  lines.push("**.env 시크릿은 `credentials/env.template`에 마스킹되어 들어 있습니다**");
  lines.push("(키 이름 기반 패턴 — `*TOKEN/*KEY/*SECRET/*PASSWORD/*CREDENTIAL`).");
  lines.push("그러나 **본문 텍스트 안에 흘러든 카드번호·고객명단·계약 내용 등은 마스킹되지 않습니다.**");
  lines.push("");
  lines.push("> 자동 스크럽은 적용되지 않습니다. 본 archive를 외부 보관/공유 전 별도 스캔을 권고합니다.");
  lines.push("> v0.8.4에서 best-effort regex 스크럽(`--scrub-content`)은 제거되었습니다 — 신뢰도 낮음 + 시나리오 불명확.");
  lines.push("");
  return lines.join("\n");
}

export const _archiveInternals = {
  mapAssetToArchivePath,
  renderArchiveYaml,
};
