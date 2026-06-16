import fs from "fs";
import path from "path";

/**
 * v1.3.0 Part C (P1) — artifact filing. Long Chief outputs (reports, plans,
 * specs) are saved to `<org>/artifacts/` and surfaced in chat as a card + file
 * attachment instead of being dumped as a wall of 1900-char chunks. The file is
 * git-versioned by the per-turn snapshot (git-snapshot.ts tracks `artifacts/`).
 *
 * Pure helpers here (no Discord deps) so they're unit-testable; the adapter
 * (`discord-adapter.ts`) calls `saveArtifact` then uploads the file.
 */

/**
 * Replies at or above this length are filed as artifacts rather than posted
 * inline. ~1500 chars ≈ a screenful; below it, an inline reply reads fine.
 */
export const ARTIFACT_MIN_CHARS = 1500;

/** Does this reply warrant filing instead of an inline post? */
export function isArtifactWorthy(text: string): boolean {
  return text.trim().length >= ARTIFACT_MIN_CHARS;
}

/** `<org>/artifacts/` directory. */
export function artifactsDir(orgCwd: string): string {
  return path.join(orgCwd, "artifacts");
}

/**
 * Derive a human title from the content: the first markdown heading, else the
 * first non-empty line. Capped to 70 chars.
 */
export function deriveArtifactTitle(text: string): string {
  const lines = text.split(/\r?\n/);
  const heading = lines.find((l) => /^#{1,6}\s+\S/.test(l.trim()));
  const raw = heading
    ? heading.trim().replace(/^#{1,6}\s+/, "")
    : (lines.find((l) => l.trim().length > 0) ?? "artifact").trim();
  const clean = raw.replace(/[`*_>]/g, "").trim();
  return clean.length > 70 ? clean.slice(0, 69) + "…" : clean || "artifact";
}

export interface SaveArtifactInput {
  /** Human title — drives the slug + card heading. */
  title: string;
  /** Full content to persist. */
  content: string;
  /** File extension without the dot. Default "md". */
  ext?: string;
}

export interface SavedArtifact {
  /** Absolute path on disk. */
  absPath: string;
  /** Bare filename (used as the upload name). */
  fileName: string;
  /** Path relative to the org dir (for display / links). */
  relPath: string;
}

/**
 * Persist an artifact under `<org>/artifacts/<ts>-<slug>.<ext>` and return its
 * paths. `now` is injectable for deterministic tests.
 */
export function saveArtifact(
  orgCwd: string,
  input: SaveArtifactInput,
  now: Date = new Date(),
): SavedArtifact {
  const dir = artifactsDir(orgCwd);
  fs.mkdirSync(dir, { recursive: true });
  const ext = (input.ext ?? "md").replace(/^\./, "");
  const fileName = `${timestampSlug(now)}-${slugify(input.title)}.${ext}`;
  const absPath = path.join(dir, fileName);
  fs.writeFileSync(absPath, input.content, "utf-8");
  return { absPath, fileName, relPath: path.join("artifacts", fileName) };
}

/** YYYYMMDD-HHMMSS in the host local time. */
function timestampSlug(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
  );
}

const SLUG_MAX = 40;

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-$/, "");
  return slug || "artifact";
}
