import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * v0.5 §6.4 — discover `.claude/skills/**\/*.md` in a repo, record path/hash/
 * size/mtime so the ledger can do incremental classification.
 *
 * Hash = SHA256(file body), first 12 hex chars. Body is read raw (no CRLF
 * normalization) because the ledger's purpose is "did this file *as on disk*
 * change since last analyze" — normalizing would mask legitimate edits that
 * only touched line endings.
 */

export interface ScannedSkill {
  /** Relative path from repo root, POSIX-normalized for stability across OS. */
  path: string;
  /** SHA256 hex, first 12 chars (§6.4 example "a3f1c8e2b9d4"). */
  hash: string;
  size_bytes: number;
  mtime_iso: string;
}

export interface ScanOptions {
  /** Override the conventional `.claude/skills` location (testing). */
  skills_subpath?: string;
}

export function scanRepoSkills(
  repoRoot: string,
  opts: ScanOptions = {}
): ScannedSkill[] {
  const sub = opts.skills_subpath ?? path.join(".claude", "skills");
  const skillsDir = path.join(repoRoot, sub);
  if (!fs.existsSync(skillsDir)) return [];

  const out: ScannedSkill[] = [];
  const stack: string[] = [skillsDir];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const rel = path.relative(repoRoot, full).split(path.sep).join("/");
        const stat = fs.statSync(full);
        const body = fs.readFileSync(full);
        const hash = crypto
          .createHash("sha256")
          .update(body)
          .digest("hex")
          .slice(0, 12);
        out.push({
          path: rel,
          hash,
          size_bytes: stat.size,
          mtime_iso: stat.mtime.toISOString(),
        });
      }
    }
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** Read body of a scanned skill (for classifier input). */
export function readScannedBody(repoRoot: string, scanned: ScannedSkill): string {
  return fs.readFileSync(
    path.join(repoRoot, scanned.path.split("/").join(path.sep)),
    "utf-8"
  );
}
