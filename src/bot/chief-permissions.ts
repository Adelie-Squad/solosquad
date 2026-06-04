import { loadDevCapabilityConfig } from "../util/config.js";

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
 * Denied even when dev is ON. Push / PR-merge / PR-close are external-effect
 * (gated separately in v1.3.0); the rest are destructive. Deny always beats
 * allow, so these win over `Bash` in the allow-list.
 *
 * Specifier syntax (`Bash(<prefix>:*)`) follows Claude Code's tool-rule form;
 * verify against the live CLI during manual QA — the exact matcher is not
 * fully documented.
 */
export const DEV_ON_DISALLOWED_TOOLS: readonly string[] = [
  "Bash(git push:*)",
  "Bash(gh pr merge:*)",
  "Bash(gh pr close:*)",
  "Bash(rm -rf:*)",
  "Bash(sudo:*)",
  "Bash(mkfs:*)",
  "Bash(dd:*)",
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
    return {
      devEnabled: true,
      permissionMode: "acceptEdits",
      allowedTools: [...DEV_ON_ALLOWED_TOOLS],
      disallowedTools: [...DEV_ON_DISALLOWED_TOOLS],
    };
  }
  return {
    devEnabled: false,
    disallowedTools: [...DEV_OFF_DISALLOWED_TOOLS],
  };
}
