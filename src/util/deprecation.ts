import chalk from "chalk";

/**
 * v0.8.4 §10 — Deprecation warning helper.
 *
 * Used to surface "this flag/command is going away" notices to users without
 * breaking existing scripts. Writes to stderr so stdout pipelines stay clean.
 *
 * Silenceable via `SOLOSQUAD_NO_DEPRECATION_WARN=1` (CI/script noise control).
 *
 * Per `docs/plan/v0.8.4-cli-surface-reduction.md` §10:
 * - v0.8.4: alias still works, but emits a deprecation warning.
 * - v1.0: alias removed entirely (matches `docs/policy/schema-stability.md` §4 —
 *   "removing a flag is major").
 */
export function warnDeprecated(args: {
  oldName: string;
  newName: string;
  removalVersion?: string;
  hint?: string;
}): void {
  if (process.env.SOLOSQUAD_NO_DEPRECATION_WARN === "1") return;

  const removal = args.removalVersion ?? "v1.0";
  const head = chalk.yellow(`[deprecated] ${args.oldName}`);
  const body = ` will be removed in ${removal}. Use ${chalk.cyan(args.newName)} instead.`;
  process.stderr.write(`${head}${body}\n`);
  if (args.hint) {
    process.stderr.write(chalk.dim(`              ${args.hint}\n`));
  }
}

/**
 * Once-per-process dedupe. Useful when a single command path can hit the same
 * deprecated flag multiple times (e.g., env var also set).
 */
const emitted = new Set<string>();
export function warnDeprecatedOnce(args: Parameters<typeof warnDeprecated>[0]): void {
  if (emitted.has(args.oldName)) return;
  emitted.add(args.oldName);
  warnDeprecated(args);
}
