import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SessionStore } from "../src/bot/session-store.js";
import { FileEventSink, chiefEventsPath } from "../src/bot/events.js";
import { chiefResetCommand } from "../src/cli/chief.js";

/** Minimal workspace + one org that `listOrganizations` / `getWorkspaceRoot` see. */
function tempWorkspace(orgSlug = "test-org"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "solosquad-chief-cli-"));
  fs.mkdirSync(path.join(dir, ".solosquad"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".solosquad", "workspace.yaml"),
    `version: 1.2.10\ndisplay_name: t\ncreated_at: 2026-06-05T00:00:00Z\n`
  );
  fs.mkdirSync(path.join(dir, orgSlug), { recursive: true });
  fs.writeFileSync(
    path.join(dir, orgSlug, ".org.yaml"),
    `slug: ${orgSlug}\nname: ${orgSlug}\nprovider: github\nrepos: []\ncreated_at: 2026-06-05T00:00:00Z\n`
  );
  return dir;
}

test("chiefResetCommand archives the existing session, mints a new id, and logs chief.session_rotated", async () => {
  const ws = tempWorkspace();
  const orgSlug = "test-org";
  const userId = "U_reset";

  const sessions = new SessionStore(ws);
  const before = sessions.ensure(orgSlug, userId).record.sessionId;

  // The command resolves its workspace from cwd (getWorkspaceRoot walks up).
  const prevCwd = process.cwd();
  process.chdir(ws);
  try {
    await chiefResetCommand({
      org: orgSlug,
      user: userId,
      reason: "post-v1.2.8-add-dir-fix",
      yes: true,
    });
  } finally {
    process.chdir(prevCwd);
  }

  // A fresh session id was minted, and the old one is archived with our reason.
  const rec = new SessionStore(ws).listForOrg(orgSlug).find((r) => r.userId === userId)!;
  assert.ok(rec, "session record still exists");
  assert.notEqual(rec.sessionId, before, "a new session id was minted");
  assert.ok(
    rec.archived?.some((a) => a.sessionId === before && a.reason === "post-v1.2.8-add-dir-fix"),
    "previous session archived with the supplied reason"
  );

  // The rotation is recorded on the Chief event feed with the new kind.
  const events = new FileEventSink(chiefEventsPath(ws, orgSlug, userId)).list();
  const rotated = events.find((e) => e.kind === "chief.session_rotated");
  assert.ok(rotated, "chief.session_rotated event was written");
});
