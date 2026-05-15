import { createHash, type Hash } from "crypto";
import { Readable, type Transform } from "stream";

/**
 * v0.7 — manifest.tsv builder for farewell archives.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §6.2 + §10 #3.
 *
 * Each row records one archive entry — its path inside the zip, SHA256
 * digest (or null for masked credentials), size, class, and notes. The
 * SHA256 is computed *while* the archive is being written (streaming) so
 * we never re-open the finished zip.
 */

export interface ManifestRow {
  /** Path inside the archive zip (forward slashes). */
  path: string;
  /** SHA256 hex digest, or `null` for entries with no hash (masked credentials). */
  sha256: string | null;
  /** Bytes, or `null` for synthetic entries. */
  size: number | null;
  /** Asset class string ("A*", "B", "C", "D", etc.). */
  cls: string;
  /** Free-form note (e.g. "wal-safe-backup", "values redacted"). */
  notes?: string;
}

export class ManifestBuilder {
  private readonly rows: ManifestRow[] = [];

  add(row: ManifestRow): void {
    this.rows.push(row);
  }

  size(): number {
    return this.rows.length;
  }

  rowsView(): readonly ManifestRow[] {
    return this.rows;
  }

  /** Render as TSV text per §6.2. */
  toTsv(): string {
    const lines: string[] = [];
    lines.push("# schema_version=1");
    lines.push(["path", "sha256", "size", "class", "notes"].join("\t"));
    for (const r of this.rows) {
      lines.push([
        escapeTsv(r.path),
        r.sha256 ?? "-",
        r.size === null ? "-" : String(r.size),
        r.cls,
        escapeTsv(r.notes ?? "-"),
      ].join("\t"));
    }
    return lines.join("\n") + "\n";
  }
}

function escapeTsv(s: string): string {
  return s.replace(/[\t\r\n]/g, " ");
}

/**
 * Compute SHA256 of a Buffer. Synchronous — use for small payloads
 * (archive.yaml, env.template, REVOKE-CHECKLIST.md, etc.).
 */
export function sha256OfBuffer(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Compute SHA256 of a Readable stream. Used for large files that we don't
 * want to load into memory (workflows transcripts, archive.sqlite). The
 * stream is consumed.
 */
export async function sha256OfStream(stream: Readable): Promise<string> {
  const hash = createHash("sha256");
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: Buffer | string) => {
      hash.update(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * A Transform-like helper that tees a stream into a hash while letting the
 * data flow through. Used by the archive writer so we can hash and zip in
 * one pass.
 */
export interface HashTap {
  /** Update with the chunk that just passed through. */
  update(chunk: Buffer | string): void;
  /** Finalize and return the hex digest. */
  digest(): string;
}

export function createHashTap(): HashTap {
  const h: Hash = createHash("sha256");
  let finalized = false;
  let cached = "";
  return {
    update(chunk: Buffer | string): void {
      if (finalized) throw new Error("HashTap already finalized");
      h.update(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    },
    digest(): string {
      if (finalized) return cached;
      cached = h.digest("hex");
      finalized = true;
      return cached;
    },
  };
}

/**
 * Wrap a Readable into a pass-through that also hashes. Caller piped both
 * the result and the hash callback into an archive writer.
 *
 * Implementation note: archiver lib reads the stream directly, so the
 * cleanest way is to attach a `data` listener that taps the hash without
 * altering the stream's data path.
 */
export function tapStream(src: Readable, tap: HashTap): Readable {
  src.on("data", (chunk: Buffer | string) => tap.update(chunk));
  return src;
}

/** Re-export for convenience in tests. */
export const _internal = { escapeTsv };
