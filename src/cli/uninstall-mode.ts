import { warnDeprecated } from "../util/deprecation.js";

/**
 * v0.8.4 §3 — Mode resolution for `solosquad uninstall`.
 *
 * Lives in its own module so unit tests can exercise the matrix without
 * pulling in the rest of the uninstall pipeline (which depends on `archiver`,
 * `better-sqlite3`, etc.). Imported by `uninstall.ts` at runtime.
 */

export type UninstallMode = "full" | "keep" | "archive-only";

export interface UninstallModeOpts {
  mode?: UninstallMode;
  /** @deprecated v0.8.4 — use `mode: "archive-only"`. Removed in v1.0. */
  archiveOnly?: boolean;
  /** @deprecated v0.8.4 — use `mode: "keep"`. Removed in v1.0. */
  keepWorkspace?: boolean;
}

/**
 * Resolve the effective uninstall mode.
 *
 * Priority order:
 *   1. legacy `--archive-only` wins (with deprecation warning),
 *   2. legacy `--keep-workspace` wins next,
 *   3. otherwise `opts.mode` is honored,
 *   4. default `"full"`.
 *
 * The legacy aliases win on purpose so existing scripts keep their behavior
 * across the v0.8.4 → v1.0 deprecation window.
 */
export function resolveUninstallMode(opts: UninstallModeOpts): UninstallMode {
  if (opts.archiveOnly) {
    warnDeprecated({
      oldName: "--archive-only",
      newName: "--mode archive-only",
    });
    return "archive-only";
  }
  if (opts.keepWorkspace) {
    warnDeprecated({
      oldName: "--keep-workspace",
      newName: "--mode keep",
    });
    return "keep";
  }
  return opts.mode ?? "full";
}
