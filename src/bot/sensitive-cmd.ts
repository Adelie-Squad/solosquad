/**
 * v1.2.9 §E — match the "external-effect" git commands that stay blocked even
 * in dev mode: `git push`, `gh pr merge`, `gh pr close`. Matches at the start
 * of the command OR right after a shell separator (&&, ||, ;, |, newline), so
 * compound commands like `cd <repo> && git push` can't smuggle one past it —
 * the CLI `--disallowed-tools` rule only catches the first segment.
 *
 * Kept in its own tiny module (no heavy imports) so the PreToolUse hook
 * (`bash-deny-hook.ts`) loads fast on every Bash call.
 */
const SENSITIVE_CMD_RE =
  /(^|&&|\|\||;|\||\n)\s*(git\s+push|gh\s+pr\s+merge|gh\s+pr\s+close)\b/;

export function isSensitiveGitCommand(cmd: string): boolean {
  return SENSITIVE_CMD_RE.test(cmd);
}
