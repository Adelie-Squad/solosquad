import { execSync } from "child_process";
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

/** Global config directory (~/.solo-agents or %APPDATA%/solo-agents). */
export function globalConfigDir(): string {
  if (IS_WINDOWS) {
    return path.join(process.env.APPDATA || os.homedir(), "solo-agents");
  }
  return path.join(os.homedir(), ".solo-agents");
}

/** npm global install command (auto-detects sudo need on Unix). */
export function npmGlobalInstallCmd(pkg: string): string {
  if (IS_WINDOWS) return `npm install -g ${pkg}`;
  const isRoot = process.getuid?.() === 0;
  return isRoot ? `npm install -g ${pkg}` : `sudo npm install -g ${pkg}`;
}

/** Default repos base path per OS. */
export function defaultReposPath(): string {
  if (IS_WINDOWS) {
    return path.join(os.homedir(), "Documents", "solo-agents-repos");
  }
  return path.join(os.homedir(), "repos");
}

/** Normalize line endings to LF. */
export function normalizeLine(content: string): string {
  return content.replace(/\r\n/g, "\n");
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
