import fs from "fs";
import path from "path";
import { getSolosquadConfigDir } from "./paths.js";
import { normalizeLine } from "./platform.js";

/**
 * v0.7 — secret masking for .env / archive credentials.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §7.1 + §10 #2.
 *
 * Known secret key patterns (case-insensitive suffix match on `*_TOKEN`,
 * `*_KEY`, `*_SECRET`, `*_PASSWORD`, `*_CREDENTIAL`). Users may extend with
 * `<workspace>/.solosquad/secret-keys.txt` (one pattern per line, glob-style
 * with `*` wildcard).
 */

const BUILTIN_PATTERNS: readonly string[] = [
  "*TOKEN",
  "*KEY",
  "*SECRET",
  "*PASSWORD",
  "*CREDENTIAL",
  "*CREDENTIALS",
] as const;

export interface MaskResult {
  /** Masked .env contents — same shape as input but secret values redacted. */
  masked: string;
  /** Keys whose values were redacted. */
  redactedKeys: string[];
  /** Keys preserved (non-secret) — useful for re-install hint. */
  preservedKeys: string[];
}

/**
 * Test whether an .env key name matches a secret pattern.
 * Comparison is case-insensitive. `*` matches any prefix.
 */
export function isSecretKey(key: string, extraPatterns: readonly string[] = []): boolean {
  const upper = key.toUpperCase();
  const all = [...BUILTIN_PATTERNS, ...extraPatterns];
  for (const pat of all) {
    if (matchesPattern(upper, pat.toUpperCase())) return true;
  }
  return false;
}

function matchesPattern(key: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*") && pattern.endsWith("*")) {
    return key.includes(pattern.slice(1, -1));
  }
  if (pattern.startsWith("*")) {
    return key.endsWith(pattern.slice(1));
  }
  if (pattern.endsWith("*")) {
    return key.startsWith(pattern.slice(0, -1));
  }
  return key === pattern;
}

/**
 * Load user-defined secret key patterns from
 * `<workspace>/.solosquad/secret-keys.txt`. One pattern per line, `#` starts
 * a comment. Returns empty array if the file does not exist.
 */
export function loadUserSecretKeys(workspace: string): string[] {
  const file = path.join(getSolosquadConfigDir(workspace), "secret-keys.txt");
  if (!fs.existsSync(file)) return [];
  const raw = normalizeLine(fs.readFileSync(file, "utf-8"));
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

/**
 * Mask the contents of a .env file. Returns the masked text plus diagnostics.
 *
 * - Lines that are blank or comments are preserved verbatim.
 * - Lines of the form `KEY=VALUE` whose KEY matches a secret pattern get
 *   the VALUE replaced with `***REDACTED-AT-<iso-ts>***`.
 * - Non-secret KEY=VALUE pairs are preserved verbatim (so re-install can
 *   pick up `WORKSPACE_NAME` / `TIMEZONE`-style configuration).
 */
export function maskEnvContent(
  envText: string,
  options: { extraPatterns?: readonly string[]; nowIso?: string } = {},
): MaskResult {
  const ts = options.nowIso ?? new Date().toISOString();
  const extra = options.extraPatterns ?? [];
  const redactedKeys: string[] = [];
  const preservedKeys: string[] = [];
  const lines = normalizeLine(envText).split("\n");

  const masked = lines
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) return line;
      const eq = line.indexOf("=");
      if (eq < 0) return line;
      const key = line.slice(0, eq).trim();
      const valueAndRest = line.slice(eq + 1);
      if (isSecretKey(key, extra)) {
        redactedKeys.push(key);
        return `${key}=***REDACTED-AT-${ts}***`;
      }
      preservedKeys.push(key);
      return `${key}=${valueAndRest}`;
    })
    .join("\n");

  return { masked, redactedKeys, preservedKeys };
}

/**
 * Convenience: mask a .env file in place. Returns the diagnostics. Does not
 * touch the file if `dryRun: true`.
 */
export function maskEnvFile(
  envPath: string,
  options: { extraPatterns?: readonly string[]; nowIso?: string; dryRun?: boolean } = {},
): MaskResult {
  const text = fs.readFileSync(envPath, "utf-8");
  const result = maskEnvContent(text, options);
  if (!options.dryRun) {
    fs.writeFileSync(envPath, result.masked, "utf-8");
  }
  return result;
}

/**
 * Built-in patterns (read-only) — exposed for tests and doctor output.
 */
export const BUILTIN_SECRET_PATTERNS: readonly string[] = BUILTIN_PATTERNS;
