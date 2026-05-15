import fs from "fs";
import path from "path";

/**
 * v0.8.1 — `schema_version` backfill for bundled + workspace SKILL.md
 * frontmatter.
 *
 * Per docs/plan/v0.8.1-security-lifecycle-pair.md §6.3. Lives under `src/`
 * (not `scripts/`) because tsc only emits files under `bin/` + `src/` —
 * the 0.8.0 → 0.8.1 migration imports the same logic at runtime.
 *
 * Both the standalone CLI (`scripts/inject-skill-schema-version.ts`) and
 * the migration script call `injectAcross()`. The function is idempotent —
 * files that already carry `schema_version` are left byte-identical.
 */

export interface InjectResult {
  injected: string[];
  alreadyHad: string[];
  skipped: { file: string; reason: string }[];
}

/** Walk a directory and return every SKILL.md found. */
export function listSkillFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && e.name === "SKILL.md") out.push(full);
    }
  }
  return out.sort();
}

/**
 * Inject `schema_version: <version>` into a frontmatter block. Returns the
 * new content, or null if the file already has the key. Throws on missing
 * frontmatter so the caller can flag the file as broken (rather than
 * silently mutating it).
 *
 * Preserves the original line endings (CRLF vs LF) so the round-trip
 * remains byte-identical for already-stamped files.
 */
export function injectSchemaVersion(content: string, version = 1): string | null {
  const bom = content.startsWith("﻿") ? "﻿" : "";
  const stripped = bom ? content.slice(1) : content;
  if (!stripped.startsWith("---\n") && !stripped.startsWith("---\r\n")) {
    throw new Error("missing YAML frontmatter (--- … ---)");
  }
  const nl = stripped.startsWith("---\r\n") ? "\r\n" : "\n";
  const fenceLen = 3 + nl.length;
  const close = stripped.indexOf(`${nl}---`, fenceLen);
  if (close === -1) {
    throw new Error("frontmatter close fence not found");
  }
  const fm = stripped.slice(fenceLen, close);
  const rest = stripped.slice(close);

  if (/^schema_version\s*:/m.test(fm)) {
    return null;
  }

  const lines = fm.split(nl);
  const descIdx = lines.findIndex((l) => /^description\s*:/.test(l));
  // Walk past any continuation lines of the description block scalar.
  let insertAt = descIdx >= 0 ? descIdx + 1 : 1;
  while (insertAt < lines.length && /^\s/.test(lines[insertAt])) {
    insertAt++;
  }
  lines.splice(insertAt, 0, `schema_version: ${version}`);

  return bom + "---" + nl + lines.join(nl) + rest;
}

/**
 * Walk a directory recursively and inject `schema_version: <version>` into
 * every SKILL.md file. Returns a structured report of injected / already-had
 * / skipped files.
 */
export function injectAcross(root: string, version = 1): InjectResult {
  const files = listSkillFiles(root);
  const result: InjectResult = { injected: [], alreadyHad: [], skipped: [] };
  for (const f of files) {
    let content: string;
    try {
      content = fs.readFileSync(f, "utf-8");
    } catch (e) {
      result.skipped.push({ file: f, reason: `read error: ${(e as Error).message}` });
      continue;
    }
    let updated: string | null;
    try {
      updated = injectSchemaVersion(content, version);
    } catch (e) {
      result.skipped.push({ file: f, reason: (e as Error).message });
      continue;
    }
    if (updated === null) {
      result.alreadyHad.push(f);
      continue;
    }
    fs.writeFileSync(f, updated);
    result.injected.push(f);
  }
  return result;
}
