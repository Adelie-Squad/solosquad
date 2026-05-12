// §8 — rollback. Drives restoreBackup() directly (avoids interactive prompt).
import { listBackups, restoreBackup } from "../../dist/src/migrations/backup.js";
import { loadWorkspaceYaml } from "../../dist/src/util/config.js";
import fs from "node:fs";
import path from "node:path";

const WS = process.env.WS;
if (!WS) {
  console.error("WS env var required");
  process.exit(1);
}

const before = loadWorkspaceYaml(WS);
console.log("Before rollback: version =", before?.version);
console.log("  pm section present?", !!before?.pm);

const backups = listBackups().filter((b) => b.meta.workspace === WS);
if (!backups.length) {
  console.error("No backups for workspace:", WS);
  process.exit(1);
}
const target = backups[0];
console.log("\nRestoring from:", target.id, `(v${target.meta.source_version})`);

restoreBackup(target.path, WS);

const after = loadWorkspaceYaml(WS);
console.log("\nAfter rollback: version =", after?.version);
console.log("  pm section present?", !!after?.pm);

// Verify .claude/agents/ no longer exists (was created by the migration)
const agentsDir = path.join(WS, "test-corp", ".claude", "agents");
console.log("  test-corp/.claude/agents/ exists?", fs.existsSync(agentsDir));
const sessionsDir = path.join(WS, "test-corp", ".solosquad", "sessions");
console.log("  test-corp/.solosquad/sessions/ exists?", fs.existsSync(sessionsDir));
