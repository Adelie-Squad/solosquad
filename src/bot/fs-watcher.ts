import fs from "fs";
import os from "os";
import path from "path";
import chokidar, { type FSWatcher } from "chokidar";
import { listOrganizations } from "../util/config.js";
import { IS_WINDOWS } from "../util/platform.js";

/**
 * v0.6 §10 — fs.watch-based SKILL hot-reload.
 *
 * The router rebuilds atomically via `rebuildRoutes()` (see
 * `src/bot/agent-router.ts`), but pre-v0.6 it only fired on the *internal*
 * S3 author-loop write path. External edits — VSCode, `git pull`,
 * out-of-band CLI patches — required a bot restart.
 *
 * This module watches the v0.5 3-tier SKILL search paths with chokidar and
 * forwards debounced change events to a caller-supplied `onReload`. The
 * caller decides what to do with the changes (`auto` reload, `prompt`,
 * `manual` — see `src/bot/reload-policy.ts`).
 *
 * Atomicity: we only emit `changedPaths`. Whoever swaps the route index is
 * responsible for using `rebuildRoutes()` (atomic swap, race-free per
 * `router-concurrency.test.ts`).
 */

export interface SkillWatcherOpts {
  /** Workspace root — `<workspace>/.solosquad/agents/` + `<workspace>/<org>/.agents/`. */
  workspace: string;
  /**
   * `auto` / `prompt` / `manual` — passed through unchanged to `onReload`.
   * The watcher itself doesn't change behavior based on mode; the caller's
   * policy module gates the actual `rebuildRoutes()` call.
   */
  mode: "auto" | "prompt" | "manual";
  /**
   * When true, the caller (reload-policy) will additionally check that
   * `origin/main` has just been merged before applying. We don't enforce
   * gitOnly inside the watcher — we just propagate the flag so the policy
   * can decide. Kept on the opts surface for symmetry / tests.
   */
  gitOnly?: boolean;
  /**
   * Called once per debounce window after one or more change events have
   * landed. `changedPaths` is the deduped, sorted list of absolute paths
   * that fired during the window.
   */
  onReload: (changedPaths: string[]) => void;
  /** Override user-global agents dir (test fixtures). Default `~/.solosquad/agents`. */
  userRoot?: string;
  /** Override debounce ms — default 300 per spec §10.2. */
  debounceMs?: number;
  /** Override polling interval — default 1000ms per spec §10. */
  pollingIntervalMs?: number;
  /**
   * Force polling on/off. Default: `IS_WINDOWS || isWSL()`. The fallback
   * keeps inotify on Linux/macOS where it's reliable and switches to polling
   * on Windows + WSL where fs.watch is flaky (chokidar maintainers ship the
   * same default).
   */
  usePolling?: boolean;
}

/** Unwatch handle returned to the caller for graceful shutdown. */
export type Unwatch = () => Promise<void>;

/**
 * Detect WSL (Windows Subsystem for Linux). chokidar's inotify path is
 * unreliable on the 9P filesystem WSL2 uses for `/mnt/c/...`, so polling
 * is the safe default. We probe `/proc/version` for "microsoft" — the
 * canonical WSL signature.
 */
export function isWSL(): boolean {
  if (os.platform() !== "linux") return false;
  try {
    const release = fs.readFileSync("/proc/version", "utf-8").toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

/**
 * 3-tier SKILL paths the v0.5 router scans, in the same order as
 * `computeTiers()` in agent-router.ts (lowest → highest priority).
 */
export function computeSkillWatchPaths(
  workspace: string,
  userRoot?: string,
): string[] {
  const paths: string[] = [];

  // Tier 3 — workspace bundled agents.
  paths.push(path.join(workspace, ".solosquad", "agents"));

  // Tier 2 — user-global agents.
  paths.push(userRoot ?? path.join(os.homedir(), ".solosquad", "agents"));

  // Tier 1 — per-org `.agents/` (auto-discovered).
  for (const org of safeListOrgs(workspace)) {
    paths.push(path.join(workspace, org.slug, ".agents"));
  }

  return paths;
}

function safeListOrgs(workspace: string): { slug: string }[] {
  try {
    return listOrganizations(workspace).map((o) => ({ slug: o.slug }));
  } catch {
    return [];
  }
}

/**
 * Start watching SKILL.md across the 3-tier search path. Returns an
 * async unwatch closure for graceful shutdown.
 *
 * Implementation notes:
 * - chokidar `ignoreInitial: true` — we only react to user edits, not the
 *   initial directory scan (the boot path already calls `rebuildRoutes()`).
 * - 300ms debounce coalesces atomic-write event storms (editors typically
 *   fire 2-3 events per save: rename → write → rename).
 * - Files in `_meta/` or any underscore-prefixed dir are skipped — the
 *   v0.5 router's `scanSkills()` skips them too, so reacting would
 *   produce no-op rebuilds.
 * - Paths that don't exist yet are still passed to chokidar; it watches
 *   the parent and picks them up when they appear (handy for fresh orgs).
 */
export function startSkillWatcher(opts: SkillWatcherOpts): Unwatch {
  const usePolling = opts.usePolling ?? (IS_WINDOWS || isWSL());
  const debounceMs = opts.debounceMs ?? 300;
  const interval = opts.pollingIntervalMs ?? 1000;

  const watchPaths = computeSkillWatchPaths(opts.workspace, opts.userRoot);

  const watcher: FSWatcher = chokidar.watch(watchPaths, {
    usePolling,
    interval,
    ignoreInitial: true,
    persistent: true,
    ignored: (filePath: string) => {
      // Only react to SKILL.md files outside `_*` folders.
      const base = path.basename(filePath);
      if (base.startsWith("_")) return true;
      // For directory entries, chokidar still asks ignored() — let dirs through.
      // We post-filter actual file events below.
      return false;
    },
  });

  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;

  const fire = (filePath: string): void => {
    if (path.basename(filePath) !== "SKILL.md") return;
    if (containsUnderscorePart(filePath, opts.workspace, opts.userRoot)) return;
    pending.add(filePath);
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const drained = Array.from(pending).sort();
      pending.clear();
      timer = null;
      try {
        opts.onReload(drained);
      } catch (err) {
        // Never let policy errors kill the watcher.
        console.error(
          `[fs-watcher] onReload threw — continuing: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }, debounceMs);
  };

  watcher.on("add", fire);
  watcher.on("change", fire);
  watcher.on("unlink", fire);
  watcher.on("error", (err) => {
    // Per §10.3: never swallow watcher failure silently.
    console.error(
      `[fs-watcher] watcher error — SKILL hot-reload degraded: ${err instanceof Error ? err.message : String(err)}`,
    );
  });

  return async () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    pending.clear();
    await watcher.close();
  };
}

/**
 * `_meta`, `_teams`, `_workflows`, etc. are reserved scanner namespaces — see
 * `agent-router.ts#scanSkills`. We skip any path segment that starts with
 * `_` to mirror that filter.
 */
function containsUnderscorePart(
  filePath: string,
  workspace: string,
  userRoot: string | undefined,
): boolean {
  const candidates = [
    path.join(workspace, ".solosquad", "agents"),
    userRoot ?? path.join(os.homedir(), ".solosquad", "agents"),
  ];
  for (const org of safeListOrgs(workspace)) {
    candidates.push(path.join(workspace, org.slug, ".agents"));
  }
  for (const base of candidates) {
    if (!filePath.startsWith(base)) continue;
    const rel = path.relative(base, filePath);
    for (const seg of rel.split(/[\\/]/)) {
      if (seg.startsWith("_")) return true;
    }
  }
  return false;
}
