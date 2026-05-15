import chalk from "chalk";
import { warnDeprecated } from "../util/deprecation.js";

/**
 * v0.8.4 §5 — Mode resolution for `solosquad import`.
 *
 * Isolated from `import.ts` (which transitively pulls in archive readers
 * and zip dependencies) so the matrix can be unit-tested standalone.
 */

export type ImportMode = "merge" | "replace";

export interface ImportModeOpts {
  mode?: ImportMode;
  /** @deprecated v0.8.4 — use `mode: "merge"`. Removed in v1.0. */
  merge?: boolean;
  /** @deprecated v0.8.4 — use `mode: "replace"`. Removed in v1.0. */
  replace?: boolean;
}

/**
 * Returns the effective mode, or `null` when the caller combined mutually
 * exclusive aliases (CLI exits non-zero in that case).
 */
export function resolveImportMode(opts: ImportModeOpts): ImportMode | null {
  if (opts.merge && opts.replace) {
    console.error(
      chalk.red("error: --merge and --replace are mutually exclusive"),
    );
    return null;
  }
  if (opts.replace) {
    warnDeprecated({ oldName: "--replace", newName: "--mode replace" });
    return "replace";
  }
  if (opts.merge) {
    warnDeprecated({ oldName: "--merge", newName: "--mode merge" });
    return "merge";
  }
  return opts.mode ?? "merge";
}
