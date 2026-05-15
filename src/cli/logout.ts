// v0.8.3 §6.1 — `solosquad logout` removed.
//
// Per docs/plan/v0.8.3-onboarding-ux-observability.md §6.1, the CLI value
// of `logout` was deemed lower than its implementation complexity. The
// replacements live in master-guide §9/§10:
//
//   - Pause the bot:   Ctrl+C on the running `solosquad bot` process.
//                      Resume with `solosquad bot` (no lockfile dance).
//   - Mask .env:       user-edited or `solosquad uninstall --archive-only`,
//                      which writes the same REVOKE-CHECKLIST.md.
//   - Archive sessions: `<org>/.solosquad/sessions/_archived/` (manual move)
//                       or `solosquad pm reset --user <id>` for new IDs.
//
// This file is kept (instead of deleted) so existing tags / SBOMs that
// referenced `dist/src/cli/logout.js` still resolve to a no-op rather than
// blowing up with a missing-module error. It exports nothing.

export {};
