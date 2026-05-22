import fs from "fs";
import path from "path";

/**
 * v1.0.1 — list registered repo slugs for an org.
 *
 * Reads `<orgDir>/repositories/` and returns slug names — covers both
 * the v0.9.1+ path-reference yamls (`<slug>.yaml` files) and the legacy
 * `<workspace>/<org>/repositories/<slug>/` directories (v0.8.x and earlier).
 * Used by the bot's `@<slug>` mention pre-processor to validate that a
 * mention resolves to a real repo before injecting a target_repo marker.
 */
export function listOrgRepoSlugs(orgDir: string): string[] {
  const reposDir = path.join(orgDir, "repositories");
  if (!fs.existsSync(reposDir)) return [];
  const slugs = new Set<string>();
  for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      slugs.add(entry.name);
    } else if (entry.isFile() && entry.name.endsWith(".yaml")) {
      slugs.add(entry.name.slice(0, -".yaml".length));
    }
  }
  return Array.from(slugs).sort();
}
