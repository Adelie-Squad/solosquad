/**
 * v1.2.9 §E — Claude Code PreToolUse(Bash) hook. Blocks `git push` /
 * `gh pr merge` / `gh pr close` even inside compound commands like
 * `cd <repo> && git push`, which the CLI `--disallowed-tools` rule does NOT
 * catch (verified against claude 2.1.162 — the deny only matches the first
 * segment). A hook that exits 2 takes precedence over every allow/deny rule
 * and applies to Task sub-agents too, so this is the reliable gate.
 *
 * Wired only when dev mode is ON (see chief-permissions.ts); dev OFF already
 * denies Bash wholesale. These three commands are "external-effect" and stay
 * blocked even with dev ON — they get per-command approval in v1.3.0.
 *
 * Runs as a standalone node script (`node bash-deny-hook.js`); reads the
 * PreToolUse payload on stdin, matches `tool_input.command`, exits 2 to block
 * or 0 to allow. Fails OPEN on malformed input (never blocks on a parse error).
 */
import { isSensitiveGitCommand } from "./sensitive-cmd.js";

let input = "";
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const parsed = JSON.parse(input) as { tool_input?: { command?: string } };
    const cmd = parsed.tool_input?.command ?? "";
    if (isSensitiveGitCommand(cmd)) {
      process.stderr.write(
        "BLOCKED by dev-mode policy: git push / gh pr merge / gh pr close need explicit approval (v1.3.0 gate).\n",
      );
      process.exit(2);
    }
  } catch {
    // malformed payload — fail open, don't block.
  }
  process.exit(0);
});
