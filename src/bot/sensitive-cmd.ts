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

/**
 * v1.3.0 Part A — extract the destination branch a `git push` writes to, so the
 * approval gate can apply the protected-branch guard. Handles the common forms:
 *
 *   git push origin feat/x          → "feat/x"
 *   git push -u origin main         → "main"
 *   git push --set-upstream o dev   → "dev"
 *   git push origin HEAD:feat/x     → "feat/x"   (refspec dst)
 *   git push origin feat/a:feat/b   → "feat/b"   (refspec dst is what's written)
 *   git push                        → null       (current branch — hook resolves)
 *   git push origin                 → null       (remote only — hook resolves)
 *   git push origin HEAD            → null       (HEAD — hook resolves)
 *
 * Returns null when no explicit destination branch is present; the caller
 * resolves the current branch (`git rev-parse --abbrev-ref HEAD`) in that case.
 * Compound commands (`cd repo && git push origin x`) are handled by isolating
 * the `git push` segment first.
 */
export function parsePushBranch(cmd: string): string | null {
  const segment = isolatePushSegment(cmd);
  if (!segment) return null;

  // Tokenize, drop the leading `git push`, then read positional (non-flag) args.
  const tokens = segment.split(/\s+/).filter(Boolean);
  // tokens[0] = "git", tokens[1] = "push"
  const positionals: string[] = [];
  for (let i = 2; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith("-")) {
      // `-o`/`--option` may take a value, but none of git push's value-taking
      // flags collide with a remote/refspec positional we care about; skip the
      // flag token only. (`--set-upstream`/`-u` are valueless.)
      continue;
    }
    positionals.push(tok);
  }

  // positionals: [remote, refspec?]. Branch lives in the refspec (2nd arg).
  const refspec = positionals[1];
  if (!refspec) return null; // no explicit target — resolve current branch
  // Refspec `src:dst` → the dst is the remote branch actually written.
  const dst = refspec.includes(":")
    ? refspec.slice(refspec.lastIndexOf(":") + 1)
    : refspec;
  // A leading `+` is the force-push marker (`+main`, `HEAD:+main`) — strip it so
  // the protected-branch guard still sees the real branch name.
  const branch = stripRefPrefix(dst.trim().replace(/^\+/, ""));
  if (!branch || branch === "HEAD") return null;
  return branch;
}

/**
 * Pull the `git push …` clause out of a (possibly compound) command. Uses the
 * same `\s+` whitespace tolerance as the detection regexes (`SENSITIVE_CMD_RE`)
 * so `git  push` / `git\tpush` can't slip past branch parsing and bypass the
 * protected-branch guard.
 */
function isolatePushSegment(cmd: string): string | null {
  const segments = cmd.split(/&&|\|\||;|\||\n/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (/^git\s+push(\s|$)/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/** `refs/heads/main` → `main`; leave bare names untouched. */
function stripRefPrefix(ref: string): string {
  return ref.replace(/^refs\/heads\//, "");
}

/**
 * v1.3.0 Part A — is `branch` a protected branch (case-insensitive)? `null`
 * branch (current-branch push the hook will resolve) returns false here; the
 * hook re-checks after resolving the actual ref.
 */
export function isProtectedBranch(
  branch: string | null,
  protectedBranches: readonly string[],
): boolean {
  if (!branch) return false;
  const lower = branch.toLowerCase();
  return protectedBranches.some((p) => p.toLowerCase() === lower);
}
