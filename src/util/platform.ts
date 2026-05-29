import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const IS_WINDOWS = os.platform() === "win32";
export const IS_MACOS = os.platform() === "darwin";
export const IS_LINUX = os.platform() === "linux";

/** Check if a command exists — cross-platform. */
export function commandExists(cmd: string): boolean {
  try {
    const check = IS_WINDOWS ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(check, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Global config directory (~/.solosquad or %APPDATA%/solosquad). */
export function globalConfigDir(): string {
  if (IS_WINDOWS) {
    return path.join(process.env.APPDATA || os.homedir(), "solosquad");
  }
  return path.join(os.homedir(), ".solosquad");
}

/**
 * npm global install command — chooses whether to prepend sudo by checking
 * the actual npm prefix's write permission (v1.0.3 fix).
 *
 * Pre-v1.0.3 unconditionally prepended `sudo` whenever the current process
 * was not root. That's wrong for nvm / fnm / asdf / Homebrew users whose
 * npm prefix lives inside their home dir (no sudo needed). The new check
 * runs `npm config get prefix` then `fs.accessSync(prefix, W_OK)` — when
 * the user can write to the prefix dir, no sudo is prepended. If anything
 * in that detection chain throws (command not found, prefix dir gone,
 * access denied), we fall back to `sudo` to keep the install command
 * usable on system-package installs (e.g. apt nodejs under /usr/local).
 */
export function npmGlobalInstallCmd(pkg: string): string {
  if (IS_WINDOWS) return `npm install -g ${pkg}`;
  try {
    const prefix = execSync("npm config get prefix", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!prefix) return `sudo npm install -g ${pkg}`;
    fs.accessSync(prefix, fs.constants.W_OK);
    return `npm install -g ${pkg}`;
  } catch {
    return `sudo npm install -g ${pkg}`;
  }
}

/** Default repos base path per OS. */
export function defaultReposPath(): string {
  if (IS_WINDOWS) {
    return path.join(os.homedir(), "Documents", "solosquad-repos");
  }
  return path.join(os.homedir(), "repos");
}

/** Normalize line endings to LF. */
export function normalizeLine(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

/**
 * v1.2.4 §A.4 — normalize a user-pasted filesystem path. The most common
 * mistake is copying a Windows path with surrounding quotes — PowerShell
 * and Explorer's "Copy as path" both add them — and the literal quotes
 * end up *in* the path argument, so `fs.existsSync` reports it missing.
 *
 * Rules (order matters):
 *   1. trim whitespace
 *   2. strip a single pair of surrounding " " or ' ' (only if balanced)
 *   3. trim whitespace again (paste sometimes leaves internal pads)
 *   4. leave the path as-is otherwise — `path.resolve` handles both
 *      `C:\foo\bar` and `/c/foo/bar` and mixed separators on Windows.
 *
 * Pure function — does not touch the filesystem. Caller is expected to
 * `path.resolve` + `fs.existsSync` after.
 */
export function normalizeUserPath(raw: string): string {
  let p = raw.trim();
  if (p.length >= 2) {
    const first = p[0];
    const last = p[p.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      p = p.slice(1, -1).trim();
    }
  }
  return p;
}

/** Parse JSONL content (CRLF-safe). */
export function parseJsonl<T = Record<string, unknown>>(content: string): T[] {
  return normalizeLine(content)
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/** Parse TSV content (CRLF-safe). */
export function parseTsv(content: string): Record<string, string>[] {
  const lines = normalizeLine(content)
    .split("\n")
    .filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const values = line.split("\t");
    return Object.fromEntries(headers.map((h, i) => [h, values[i] || ""]));
  });
}

/** Platform info string for diagnostics. */
export function platformInfo(): string {
  return `${os.platform()} ${os.arch()} (${os.release()})`;
}

/** Current shell name. */
export function shellName(): string {
  return process.env.SHELL || process.env.ComSpec || "unknown";
}
