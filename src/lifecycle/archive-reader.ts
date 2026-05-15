import fs from "fs";
import { createHash } from "crypto";
import yauzl from "yauzl";
import yaml from "js-yaml";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.8.1 — yauzl-based archive reader.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §4.2 + §5. Shared between
 * `solosquad import` and `solosquad archive verify/info/list`. `archiver`
 * is writer-only (no reader API) so v0.8.1 introduces `yauzl` as a devDep
 * — the archive verify CLI is the only runtime user. Tests prove the
 * reader can round-trip a v0.7-format archive.
 *
 * Two access modes:
 *   1. `readArchiveMeta(path)` — extract `archive.yaml` + `manifest.tsv`
 *      only. Cheap, no full decompression. Used by `verify` + `info`.
 *   2. `extractAllEntries(path, onEntry)` — iterate every entry with its
 *      decompressed Buffer + computed SHA256. Used by `verify` (SHA tally)
 *      and `import` (unpack to disk).
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface ManifestEntry {
  path: string;
  /** SHA256 hex digest, or null for "-" placeholder entries (class D). */
  sha256: string | null;
  /** File size in bytes, or null for "-" placeholder. */
  size: number | null;
  cls: string;
  notes: string;
}

export interface ManifestDoc {
  schemaVersion: number;
  entries: ManifestEntry[];
}

export interface ArchiveYamlDoc {
  schema_version: number;
  export_ts: string;
  solosquad_version: string;
  workspace_slug: string;
  created_by?: string;
  included_orgs: string[];
  archive_format: string;
  import_compat?: {
    min_solosquad_version: string;
    max_schema_version_supported: number;
    archive_format: string;
  };
  [k: string]: unknown;
}

export interface ArchiveMeta {
  archiveYaml: ArchiveYamlDoc;
  manifest: ManifestDoc;
}

export interface ExtractedEntry {
  /** Path inside the archive (forward slashes). */
  archivePath: string;
  /** Decompressed contents. */
  buffer: Buffer;
  /** SHA256 computed from the decompressed bytes. */
  sha256: string;
  /** Uncompressed size (== buffer.byteLength). */
  size: number;
}

export interface VerifyReport {
  ok: boolean;
  /** Manifest schema_version (1 in v0.7-v0.8.1). */
  schemaVersion: number;
  /** Number of manifest rows. */
  manifestRows: number;
  /** Number of entries actually present in the zip (excludes manifest.tsv itself). */
  archiveRows: number;
  /** Entries whose computed SHA256 disagrees with the manifest. */
  shaMismatches: Array<{ path: string; manifest: string; actual: string }>;
  /** Entries listed in the manifest but absent from the zip. */
  missingFromArchive: string[];
  /** Entries present in the zip but absent from the manifest (besides manifest.tsv). */
  extraInArchive: string[];
  /** Schema-compat findings (CLI version vs min_solosquad_version, format, …). */
  schemaCompat: SchemaCompatResult;
}

export interface SchemaCompatResult {
  ok: boolean;
  reasons: string[];
}

/* -------------------------------------------------------------------------- */
/* Meta-only read (archive.yaml + manifest.tsv)                                */
/* -------------------------------------------------------------------------- */

/**
 * Extract just archive.yaml and manifest.tsv from a zip. The rest of the
 * archive is not decompressed. Used by `verify` (pre-check) and `info`.
 */
export async function readArchiveMeta(archivePath: string): Promise<ArchiveMeta> {
  if (!fs.existsSync(archivePath)) {
    throw new Error(`archive not found: ${archivePath}`);
  }
  const wanted = new Set(["archive.yaml", "manifest.tsv"]);
  const collected = new Map<string, Buffer>();

  await iterateEntries(archivePath, async (entry, readBuffer) => {
    if (wanted.has(entry.fileName)) {
      const buf = await readBuffer();
      collected.set(entry.fileName, buf);
    }
  });

  const archiveYamlBuf = collected.get("archive.yaml");
  const manifestBuf = collected.get("manifest.tsv");
  if (!archiveYamlBuf) {
    throw new Error(`archive.yaml missing in ${archivePath}`);
  }
  if (!manifestBuf) {
    throw new Error(`manifest.tsv missing in ${archivePath}`);
  }

  const archiveYaml = yaml.load(archiveYamlBuf.toString("utf-8")) as ArchiveYamlDoc;
  if (!archiveYaml || typeof archiveYaml !== "object") {
    throw new Error("archive.yaml is not a valid YAML object");
  }
  const manifest = parseManifestTsv(manifestBuf.toString("utf-8"));

  return { archiveYaml, manifest };
}

/* -------------------------------------------------------------------------- */
/* Manifest parser                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Parse a manifest.tsv body produced by `ManifestBuilder.toTsv()`.
 *
 * Format:
 *   # schema_version=N
 *   path<TAB>sha256<TAB>size<TAB>class<TAB>notes
 *   <rows...>
 */
export function parseManifestTsv(text: string): ManifestDoc {
  const lines = normalizeLine(text).split("\n");
  let schemaVersion = 1;
  const entries: ManifestEntry[] = [];
  let sawHeader = false;

  for (const raw of lines) {
    if (raw.trim().length === 0) continue;
    if (raw.startsWith("#")) {
      const m = /schema_version\s*=\s*(\d+)/.exec(raw);
      if (m) schemaVersion = parseInt(m[1], 10);
      continue;
    }
    if (!sawHeader) {
      // The header row is `path\tsha256\tsize\tclass\tnotes`.
      const parts = raw.split("\t");
      if (parts[0] === "path" && parts[1] === "sha256") {
        sawHeader = true;
        continue;
      }
    }
    const cols = raw.split("\t");
    if (cols.length < 5) continue;
    const [p, sha, size, cls, notes] = cols;
    entries.push({
      path: p,
      sha256: sha === "-" ? null : sha,
      size: size === "-" ? null : parseInt(size, 10),
      cls,
      notes: notes ?? "-",
    });
  }
  return { schemaVersion, entries };
}

/* -------------------------------------------------------------------------- */
/* Full extraction                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Iterate every entry in a zip, decompress it, and invoke the callback with
 * the resulting buffer + SHA. Excludes directory entries.
 *
 * Streaming is per-entry — the caller receives one entry at a time, so
 * memory is bounded by the largest single entry rather than the whole zip.
 */
export async function extractAllEntries(
  archivePath: string,
  onEntry: (e: ExtractedEntry) => Promise<void> | void,
): Promise<void> {
  await iterateEntries(archivePath, async (entry, readBuffer) => {
    if (/\/$/.test(entry.fileName)) return; // directory
    const buf = await readBuffer();
    const sha256 = createHash("sha256").update(buf).digest("hex");
    await onEntry({
      archivePath: entry.fileName,
      buffer: buf,
      sha256,
      size: buf.byteLength,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Verify                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Verify a v0.7-format archive — SHA × manifest tally + schema-compat
 * check. Returns a structured report rather than throwing so callers
 * (import / archive verify CLI) can decide how to format the output.
 */
export async function verifyArchive(
  archivePath: string,
  opts: { cliVersion: string },
): Promise<VerifyReport> {
  const meta = await readArchiveMeta(archivePath);

  const expected = new Map<string, ManifestEntry>();
  for (const m of meta.manifest.entries) expected.set(m.path, m);

  const shaMismatches: VerifyReport["shaMismatches"] = [];
  const extraInArchive: string[] = [];
  const seen = new Set<string>();
  let archiveRows = 0;

  await extractAllEntries(archivePath, (e) => {
    if (e.archivePath === "manifest.tsv") return; // not listed in itself per §6.2
    archiveRows++;
    seen.add(e.archivePath);
    const exp = expected.get(e.archivePath);
    if (!exp) {
      extraInArchive.push(e.archivePath);
      return;
    }
    // sha256 = null means the entry is "class D" (masked credentials) — the
    // archive intentionally does not hash the masked bytes, so we just skip
    // SHA verification. Existence is enough.
    if (exp.sha256 === null) return;
    if (exp.sha256 !== e.sha256) {
      shaMismatches.push({ path: e.archivePath, manifest: exp.sha256, actual: e.sha256 });
    }
  });

  const missingFromArchive: string[] = [];
  for (const m of meta.manifest.entries) {
    if (!seen.has(m.path)) missingFromArchive.push(m.path);
  }

  const schemaCompat = checkSchemaCompat(meta.archiveYaml, opts.cliVersion);

  return {
    ok:
      shaMismatches.length === 0 &&
      missingFromArchive.length === 0 &&
      extraInArchive.length === 0 &&
      schemaCompat.ok,
    schemaVersion: meta.manifest.schemaVersion,
    manifestRows: meta.manifest.entries.length,
    archiveRows,
    shaMismatches,
    missingFromArchive,
    extraInArchive,
    schemaCompat,
  };
}

/**
 * Schema compatibility — does the archive declare a format the current
 * CLI understands?
 *
 *   1. `archive_format == "zip-v1"` (only known format in v0.7+v0.8.1)
 *   2. `import_compat.min_solosquad_version <= cliVersion`
 *   3. `import_compat.max_schema_version_supported >= 1` (current schema)
 *   4. `schema_version == 1`
 */
export function checkSchemaCompat(
  archiveYaml: ArchiveYamlDoc,
  cliVersion: string,
): SchemaCompatResult {
  const reasons: string[] = [];

  const format = archiveYaml.archive_format ?? archiveYaml.import_compat?.archive_format;
  if (format !== "zip-v1") {
    reasons.push(`archive_format "${format ?? "(unset)"}" is not supported (expected zip-v1)`);
  }

  const schemaVersion = archiveYaml.schema_version;
  if (typeof schemaVersion !== "number" || schemaVersion < 1) {
    reasons.push(`archive.yaml schema_version "${schemaVersion}" is invalid (expected ≥ 1)`);
  }

  const compat = archiveYaml.import_compat;
  if (compat) {
    const min = compat.min_solosquad_version;
    if (typeof min === "string" && compareSemver(cliVersion, min) < 0) {
      reasons.push(
        `archive requires solosquad ≥ ${min} but current CLI is ${cliVersion}`,
      );
    }
    if (typeof compat.max_schema_version_supported === "number" && compat.max_schema_version_supported < 1) {
      reasons.push(
        `archive declares max_schema_version_supported=${compat.max_schema_version_supported}; current importer needs ≥ 1`,
      );
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/* -------------------------------------------------------------------------- */
/* yauzl wrapper                                                              */
/* -------------------------------------------------------------------------- */

interface YauzlEntry {
  fileName: string;
  uncompressedSize: number;
}

/**
 * Internal — wraps yauzl's event-based API with an async iterator pattern.
 * `readBuffer()` decompresses the current entry into a Buffer. Skipping an
 * entry (not calling readBuffer) still advances yauzl correctly.
 */
function iterateEntries(
  archivePath: string,
  visitor: (entry: YauzlEntry, readBuffer: () => Promise<Buffer>) => Promise<void> | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(err ?? new Error("yauzl.open returned no handle"));
        return;
      }

      const queue: Array<() => Promise<void>> = [];
      let entriesDone = false;
      let processing = false;

      const drain = async (): Promise<void> => {
        if (processing) return;
        processing = true;
        try {
          while (queue.length > 0) {
            const task = queue.shift();
            if (task) await task();
          }
          if (entriesDone) {
            zip.close();
            resolve();
          } else {
            zip.readEntry();
          }
        } catch (err) {
          zip.close();
          reject(err);
        } finally {
          processing = false;
        }
      };

      zip.on("entry", (entry) => {
        const ye: YauzlEntry = {
          fileName: entry.fileName,
          uncompressedSize: entry.uncompressedSize,
        };
        const readBuffer = (): Promise<Buffer> =>
          new Promise<Buffer>((res, rej) => {
            zip.openReadStream(entry, (err, stream) => {
              if (err || !stream) {
                rej(err ?? new Error("openReadStream returned no stream"));
                return;
              }
              const chunks: Buffer[] = [];
              stream.on("data", (c) => {
                chunks.push(typeof c === "string" ? Buffer.from(c) : c);
              });
              stream.on("end", () => res(Buffer.concat(chunks)));
              stream.on("error", rej);
            });
          });

        queue.push(async () => {
          await visitor(ye, readBuffer);
        });
        void drain();
      });

      zip.on("end", () => {
        entriesDone = true;
        void drain();
      });

      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

/* -------------------------------------------------------------------------- */
/* SemVer helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Compare two semver-ish strings (numeric only). Returns negative, 0, or
 * positive — same contract as `Array.prototype.sort`.
 */
export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((p) => parseInt(p, 10) || 0);
  const pb = b.split(".").map((p) => parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
