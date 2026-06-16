import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadDevCapabilityConfig } from "../util/config.js";
import { getWorkspaceDir } from "../util/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * v1.2.9 §E — translate the workspace dev-capability master toggle into the
 * Claude Code spawn permission flags Chief's `claude --print` session runs
 * with. This is what actually lets (or stops) agents from writing files and
 * running git in the headless bot, and fixes the v1.2.6-era hang where an
 * unapproved Write/Bash blocked forever waiting for a TTY prompt.
 *
 * dev ON  → `acceptEdits` + a broad allow-list (Read/Edit/Write/Bash/Task/…)
 *           so file edits + git add/commit/checkout/branch + npm run without a
 *           prompt, with push/merge/close + destructive commands denied.
 * dev OFF → no permission mode, but Bash/Edit/Write DENIED (deny removes the
 *           tool, so the agent can't trigger a prompt → no hang). Chief is told
 *           to suggest `/grant` when a task needs write access.
 *
 * NOTE: `git push` / `gh pr merge` / `gh pr close` stay denied even when dev is
 * ON — those "external-effect" commands are gated by the per-command approval
 * (v1.3.0 dev-confirm gate), not by the coarse dev toggle.
 */

/** dev ON: tools auto-approved (no prompt) in the headless spawn. */
export const DEV_ON_ALLOWED_TOOLS: readonly string[] = [
  "Read",
  "Grep",
  "Glob",
  "Edit",
  "Write",
  "Bash",
  "Task",
  "TodoWrite",
  "WebFetch",
  "WebSearch",
  "NotebookEdit",
];

/**
 * Always denied when dev is ON — destructive commands with no approval path.
 * Deny beats allow, so these win over `Bash` in the allow-list.
 *
 * Specifier syntax (`Bash(<prefix>:*)`) follows Claude Code's tool-rule form;
 * verify against the live CLI during manual QA — the exact matcher is not
 * fully documented.
 */
export const DEV_ON_DESTRUCTIVE_DISALLOWED_TOOLS: readonly string[] = [
  "Bash(rm -rf:*)",
  "Bash(sudo:*)",
  "Bash(mkfs:*)",
  "Bash(dd:*)",
];

/**
 * External-effect commands (push / PR-merge / PR-close). These are gated by the
 * v1.3.0 dev-confirm approval hook, NOT a static deny — a static deny would
 * block even an *approved* push (the hook's exit-0 "allow" cannot override an
 * explicit `--disallowed-tools` deny rule). They are added to the deny list
 * ONLY as a fail-closed fallback when the approve-hook settings file could not
 * be written (no hook ⇒ block outright, matching pre-v1.3.0 behavior).
 */
export const DEV_ON_EXTERNAL_EFFECT_DISALLOWED_TOOLS: readonly string[] = [
  "Bash(git push:*)",
  "Bash(gh pr merge:*)",
  "Bash(gh pr close:*)",
];

/**
 * @deprecated v1.3.0 — kept for back-compat with callers/tests that referenced
 * the combined list. New code uses the split constants above: destructive are
 * always denied; external-effect are denied only when the hook isn't wired.
 */
export const DEV_ON_DISALLOWED_TOOLS: readonly string[] = [
  ...DEV_ON_EXTERNAL_EFFECT_DISALLOWED_TOOLS,
  ...DEV_ON_DESTRUCTIVE_DISALLOWED_TOOLS,
];

/** dev OFF: deny write/exec tools so they can't prompt (→ no hang). */
export const DEV_OFF_DISALLOWED_TOOLS: readonly string[] = [
  "Bash",
  "Edit",
  "Write",
];

export interface ChiefSpawnPermissions {
  /** Whether dev mode (file write + git) is enabled for this workspace. */
  devEnabled: boolean;
  permissionMode?: "acceptEdits";
  allowedTools?: string[];
  disallowedTools?: string[];
  /**
   * v1.2.9 §E — path to a Claude Code settings file registering the
   * PreToolUse Bash deny hook (→ `--settings`). The hook blocks `git push` /
   * `gh pr merge` / `gh pr close` even inside compound commands
   * (`cd <repo> && git push`), which the CLI `--disallowed-tools` rule can't.
   * Only set in dev-ON mode. Undefined when the settings file can't be written
   * (falls back to deny-only — single-segment push still blocked).
   */
  settingsPath?: string;
}

/**
 * v1.2.9 §E / v1.3.0 Part A — write (idempotently) the settings file that
 * registers the PreToolUse Bash hook, returning its path for `--settings`.
 * Lives under `<workspace>/.solosquad/`. Best-effort: returns undefined if it
 * can't write.
 *
 * v1.3.0 Part A repoints the hook from the deny-only `bash-deny-hook.js` to the
 * approve-flow `dev-confirm-hook.js`: that hook still BLOCKS protected-branch
 * pushes (fail-closed guard), but feature-branch `git push` / `gh pr merge` /
 * `gh pr close` now route through the per-command approval card instead of an
 * unconditional deny. `bash-deny-hook.js` stays in the tree (unwired) as the
 * pure-deny fallback. The CLI `--disallowed-tools` deny rules in
 * DEV_ON_DISALLOWED_TOOLS remain as a redundant first-segment guard.
 */
function ensureDevDenySettings(workspace: string): string | undefined {
  const hookScript = path.join(__dirname, "dev-confirm-hook.js");
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `node "${hookScript}"` }],
        },
      ],
    },
  };
  const dir = path.join(workspace, ".solosquad");
  const file = path.join(dir, "dev-deny-settings.json");
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2));
    return file;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the spawn permission flags from `workspace.yaml.dev_capability`.
 * `workspace` omitted ⇒ resolved from the ambient workspace root.
 */
export function resolveChiefSpawnPermissions(
  workspace?: string,
): ChiefSpawnPermissions {
  const cfg = loadDevCapabilityConfig(workspace);
  if (cfg.enabled) {
    const settingsPath = ensureDevDenySettings(workspace ?? getWorkspaceDir());
    // When the approve-hook is wired (settingsPath written), the hook is the
    // sole gate for push/PR commands — a static deny would block even approved
    // pushes. If the settings file couldn't be written, fall back to denying
    // them outright (fail-closed: no hook ⇒ no push).
    const disallowedTools = settingsPath
      ? [...DEV_ON_DESTRUCTIVE_DISALLOWED_TOOLS]
      : [...DEV_ON_DISALLOWED_TOOLS];
    return {
      devEnabled: true,
      permissionMode: "acceptEdits",
      allowedTools: [...DEV_ON_ALLOWED_TOOLS],
      disallowedTools,
      settingsPath,
    };
  }
  return {
    devEnabled: false,
    disallowedTools: [...DEV_OFF_DISALLOWED_TOOLS],
  };
}
