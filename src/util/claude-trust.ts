import fs from "fs";
import os from "os";
import path from "path";

/**
 * v1.2.4 §A.5 — pre-grant Claude Code's directory trust for SoloSquad-
 * managed paths so the bot's `claude --print` spawn doesn't hit the
 * interactive trust dialog the first time it runs in a new repo or org
 * directory.
 *
 * Claude Code stores its per-directory trust + project settings at
 *   ~/.claude.json           (POSIX)
 *   %USERPROFILE%\.claude.json (Windows; os.homedir() returns the same)
 * under the `projects` map where each key is an absolute directory
 * path. We touch only one field — `hasTrustDialogAccepted` — and seed
 * the surrounding empty-default shape so Claude's reader doesn't choke
 * on a partial entry.
 *
 * Idempotent. Best-effort: a missing config file (fresh Claude install,
 * never run yet) or any write failure just logs and returns false —
 * the bot still works; the user only sees the trust prompt once.
 */

interface ClaudeProjectEntry {
  allowedTools: string[];
  mcpContextUris: string[];
  mcpServers: Record<string, unknown>;
  enabledMcpjsonServers: string[];
  disabledMcpjsonServers: string[];
  hasTrustDialogAccepted: boolean;
  projectOnboardingSeenCount: number;
  hasClaudeMdExternalIncludesApproved: boolean;
  hasClaudeMdExternalIncludesWarningShown: boolean;
}

interface ClaudeConfig {
  projects?: Record<string, ClaudeProjectEntry>;
  [k: string]: unknown;
}

function defaultProjectEntry(): ClaudeProjectEntry {
  return {
    allowedTools: [],
    mcpContextUris: [],
    mcpServers: {},
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
    hasTrustDialogAccepted: true,
    projectOnboardingSeenCount: 0,
    hasClaudeMdExternalIncludesApproved: false,
    hasClaudeMdExternalIncludesWarningShown: false,
  };
}

/**
 * Path to Claude Code's user-level config file. Cross-platform —
 * `os.homedir()` returns `%USERPROFILE%` on Windows and `$HOME` on
 * POSIX. Override only for tests via the `home` arg.
 */
export function claudeConfigPath(home?: string): string {
  return path.join(home ?? os.homedir(), ".claude.json");
}

/**
 * Read + ensure-trust + write back. Returns:
 *   "granted"   — entry created or updated to hasTrustDialogAccepted=true
 *   "already"   — entry already had hasTrustDialogAccepted=true
 *   "no-config" — ~/.claude.json missing (fresh Claude install)
 *   "error"     — read/parse/write failure (best-effort; bot still works)
 */
export type GrantResult = "granted" | "already" | "no-config" | "error";

export function grantClaudeTrust(
  absDir: string,
  opts: { home?: string; quiet?: boolean } = {},
): GrantResult {
  const cfgPath = claudeConfigPath(opts.home);
  const resolved = path.resolve(absDir);

  if (!fs.existsSync(cfgPath)) {
    if (!opts.quiet) {
      console.log(
        `[claude-trust] ~/.claude.json missing — skipping trust grant for ${resolved}. ` +
          "Run `claude --print 'hi'` once to initialize, then re-run.",
      );
    }
    return "no-config";
  }

  let cfg: ClaudeConfig;
  try {
    const body = fs.readFileSync(cfgPath, "utf-8");
    cfg = JSON.parse(body) as ClaudeConfig;
  } catch (err) {
    if (!opts.quiet) {
      console.log(
        `[claude-trust] failed to parse ${cfgPath}: ${
          (err as Error).message
        } — skipping trust grant for ${resolved}.`,
      );
    }
    return "error";
  }

  if (!cfg.projects || typeof cfg.projects !== "object") {
    cfg.projects = {};
  }

  const existing = cfg.projects[resolved];
  if (existing && existing.hasTrustDialogAccepted === true) {
    return "already";
  }

  cfg.projects[resolved] = {
    ...defaultProjectEntry(),
    ...(existing ?? {}),
    hasTrustDialogAccepted: true,
  };

  try {
    // Atomic-ish write — claude.json is in the user's home so write +
    // rename is sufficient. Pretty-print 2-space to match Claude's own
    // formatting (less diff noise if the user inspects).
    const tmp = cfgPath + ".solosquad-tmp";
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, cfgPath);
  } catch (err) {
    if (!opts.quiet) {
      console.log(
        `[claude-trust] failed to write ${cfgPath}: ${
          (err as Error).message
        } — Claude will prompt for trust on first use in ${resolved}.`,
      );
    }
    return "error";
  }

  if (!opts.quiet) {
    console.log(`[claude-trust] granted hasTrustDialogAccepted for ${resolved}`);
  }
  return "granted";
}

/**
 * Grant trust for multiple paths in one config rewrite. Saves N-1 disk
 * roundtrips when registering several repos in a batch (init repo loop).
 * Returns a parallel array of GrantResult per input path.
 */
export function grantClaudeTrustMany(
  absDirs: string[],
  opts: { home?: string; quiet?: boolean } = {},
): GrantResult[] {
  if (absDirs.length === 0) return [];
  const cfgPath = claudeConfigPath(opts.home);

  if (!fs.existsSync(cfgPath)) {
    if (!opts.quiet) {
      console.log(
        `[claude-trust] ~/.claude.json missing — skipping batch trust grant for ${absDirs.length} path(s).`,
      );
    }
    return absDirs.map(() => "no-config");
  }

  let cfg: ClaudeConfig;
  try {
    cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as ClaudeConfig;
  } catch (err) {
    if (!opts.quiet) {
      console.log(
        `[claude-trust] failed to parse ${cfgPath}: ${(err as Error).message}`,
      );
    }
    return absDirs.map(() => "error");
  }

  if (!cfg.projects || typeof cfg.projects !== "object") cfg.projects = {};

  const results: GrantResult[] = [];
  for (const dir of absDirs) {
    const resolved = path.resolve(dir);
    const existing = cfg.projects[resolved];
    if (existing && existing.hasTrustDialogAccepted === true) {
      results.push("already");
      continue;
    }
    cfg.projects[resolved] = {
      ...defaultProjectEntry(),
      ...(existing ?? {}),
      hasTrustDialogAccepted: true,
    };
    results.push("granted");
  }

  try {
    const tmp = cfgPath + ".solosquad-tmp";
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, cfgPath);
  } catch (err) {
    if (!opts.quiet) {
      console.log(
        `[claude-trust] batch write failed: ${(err as Error).message}`,
      );
    }
    return absDirs.map(() => "error");
  }

  if (!opts.quiet) {
    const granted = results.filter((r) => r === "granted").length;
    if (granted > 0) {
      console.log(
        `[claude-trust] granted hasTrustDialogAccepted for ${granted} path(s)`,
      );
    }
  }
  return results;
}
