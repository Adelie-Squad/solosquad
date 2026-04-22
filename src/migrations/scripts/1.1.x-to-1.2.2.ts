import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import type {
  Migration,
  MigrationPlan,
  MigrationStep,
  VerifyResult,
} from "../types.js";
import { loadEnv, loadProducts, saveEnv } from "../../util/config.js";
import { normalizeLine } from "../../util/platform.js";

const TARGET = "1.2.2";

const ROOT_CONFIG_DIRS = ["agents", "routines", "core", "templates", "orchestrator"];
const MESSENGER_PLATFORMS = ["slack", "discord", "telegram"];

function resolveReposBase(workspace: string): string | null {
  const envFile = path.join(workspace, ".env");
  if (!fs.existsSync(envFile)) return null;
  const content = normalizeLine(fs.readFileSync(envFile, "utf-8"));
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("REPOS_BASE_PATH=")) {
      const value = trimmed.slice("REPOS_BASE_PATH=".length).trim();
      if (!value) return null;
      return value.replace(/^~/, os.homedir());
    }
  }
  return null;
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function moveDir(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  if (fs.existsSync(to)) {
    // Merge — copy contents then remove source
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      if (entry.isDirectory()) {
        moveDir(src, dst);
      } else {
        fs.renameSync(src, dst);
      }
    }
    fs.rmdirSync(from);
  } else {
    fs.renameSync(from, to);
  }
}

function moveFile(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

export const migration: Migration = {
  from: "1.1.x",
  to: TARGET,
  description: "Restructure to .solosquad/ config + per-org directories",

  async detect(workspace: string): Promise<boolean> {
    if (fs.existsSync(path.join(workspace, ".solosquad"))) return false;
    return ROOT_CONFIG_DIRS.every((d) => fs.existsSync(path.join(workspace, d)));
  },

  async plan(workspace: string): Promise<MigrationPlan> {
    const steps: MigrationStep[] = [];
    const warnings: string[] = [];
    const irreversible: string[] = [];

    // 1. workspace config → .solosquad/
    for (const d of ROOT_CONFIG_DIRS) {
      const src = path.join(workspace, d);
      if (dirExists(src)) {
        steps.push({
          kind: "move",
          from: `${d}/`,
          to: `.solosquad/${d}/`,
          description: `Move ${d}/ into .solosquad/`,
        });
      }
    }
    const envFile = path.join(workspace, ".env");
    if (fs.existsSync(envFile)) {
      steps.push({
        kind: "move",
        from: ".env",
        to: ".solosquad/.env",
        description: "Move .env into .solosquad/",
      });
    }

    // 2. Products → organizations
    const products = loadProducts(workspace);
    const reposBase = resolveReposBase(workspace);

    if (!reposBase || !fs.existsSync(reposBase)) {
      if (products.length) {
        warnings.push(
          `REPOS_BASE_PATH "${reposBase ?? "(unset)"}" does not exist — product directories will not be moved. Manual intervention required.`
        );
      }
    } else {
      for (const p of products) {
        const srcProductDir = path.join(reposBase, p.slug);
        const destOrgDir = path.join(workspace, p.slug);
        if (!dirExists(srcProductDir)) {
          warnings.push(`Product "${p.name}" has no directory at ${srcProductDir} — skipped.`);
          continue;
        }
        if (dirExists(destOrgDir)) {
          warnings.push(
            `Target directory ${p.slug}/ already exists at workspace root — skipping to avoid overwrite. Resolve manually.`
          );
          continue;
        }
        steps.push({
          kind: "move",
          from: `${reposBase}/${p.slug}/`,
          to: `${p.slug}/`,
          description: `Move product "${p.name}" to workspace-root organization`,
        });
        steps.push({
          kind: "rename",
          from: `${p.slug}/projects/`,
          to: `${p.slug}/workflows/`,
          description: "Rename projects/ → workflows/",
        });
        steps.push({
          kind: "generate",
          to: `${p.slug}/.org.yaml`,
          description: `Generate .org.yaml for "${p.name}"`,
          payload: { product: p },
        });
      }
    }

    // 3. Single-messenger guard
    const env = loadEnv(workspace);
    const messenger = env.MESSENGER ?? "";
    if (messenger.includes(",")) {
      irreversible.push(
        `MESSENGER was "${messenger}" (multi-platform). Keeping only the first (${messenger.split(",")[0].trim()}). ` +
          `Create separate workspaces for other platforms.`
      );
      steps.push({
        kind: "update",
        to: ".solosquad/.env",
        description: `Collapse MESSENGER to "${messenger.split(",")[0].trim()}"`,
      });
    }

    // 4. REPOS_BASE_PATH removal
    if (env.REPOS_BASE_PATH) {
      irreversible.push("Remove REPOS_BASE_PATH from .env (obsolete in v1.2.2).");
      steps.push({
        kind: "update",
        to: ".solosquad/.env",
        description: "Remove REPOS_BASE_PATH",
      });
    }

    // 5. workspace.yaml
    steps.push({
      kind: "generate",
      to: ".solosquad/workspace.yaml",
      description: `Write workspace.yaml (version: ${TARGET})`,
    });

    return {
      steps,
      warnings,
      irreversible_changes: irreversible,
      estimated_disk_delta_mb: 0,
    };
  },

  async apply(workspace: string, _plan: MigrationPlan): Promise<void> {
    const solosquad = path.join(workspace, ".solosquad");
    fs.mkdirSync(solosquad, { recursive: true });

    // Snapshot inputs BEFORE we move config dirs (core/, .env) — otherwise
    // loadProducts() and resolveReposBase() would return empty values once
    // their source files have been relocated.
    const products = loadProducts(workspace);
    const reposBase = resolveReposBase(workspace);
    const preEnv = loadEnv(workspace);

    // 1. Move config dirs
    for (const d of ROOT_CONFIG_DIRS) {
      const src = path.join(workspace, d);
      if (!dirExists(src)) continue;
      const dst = path.join(solosquad, d);
      moveDir(src, dst);
    }

    // 2. Move .env
    const srcEnv = path.join(workspace, ".env");
    const dstEnv = path.join(solosquad, ".env");
    if (fs.existsSync(srcEnv) && !fs.existsSync(dstEnv)) {
      moveFile(srcEnv, dstEnv);
    }

    // 3. Products → organizations (uses the snapshot captured above)

    if (reposBase && fs.existsSync(reposBase)) {
      for (const p of products) {
        const srcProductDir = path.join(reposBase, p.slug);
        const destOrgDir = path.join(workspace, p.slug);
        if (!dirExists(srcProductDir) || dirExists(destOrgDir)) continue;

        moveDir(srcProductDir, destOrgDir);

        // Rename projects/ → workflows/
        const legacyProjects = path.join(destOrgDir, "projects");
        const newWorkflows = path.join(destOrgDir, "workflows");
        if (dirExists(legacyProjects) && !dirExists(newWorkflows)) {
          moveDir(legacyProjects, newWorkflows);
        }

        // Flatten product/ → org root (brief.md, weekly-state.md into org root)
        const legacyProductDir = path.join(destOrgDir, "product");
        if (dirExists(legacyProductDir)) {
          for (const entry of fs.readdirSync(legacyProductDir)) {
            const src = path.join(legacyProductDir, entry);
            const dst = path.join(destOrgDir, entry);
            if (!fs.existsSync(dst)) {
              fs.renameSync(src, dst);
            }
          }
          try {
            fs.rmdirSync(legacyProductDir);
          } catch {
            /* non-empty — leave as-is */
          }
        }

        // Generate .org.yaml
        const orgYaml = {
          name: p.name,
          slug: p.slug,
          provider: p.github_org ? "github" : "local",
          remote_url: p.github_org ? `https://github.com/${p.github_org}` : null,
          homepage: null,
          products: [
            {
              name: p.name,
              slug: p.slug,
              description: "",
              repos: [],
            },
          ],
          created_at: new Date().toISOString(),
        };
        fs.writeFileSync(
          path.join(destOrgDir, ".org.yaml"),
          yaml.dump(orgYaml, { lineWidth: 100 })
        );
      }
    }

    // 4. Env cleanup — collapse MESSENGER, remove REPOS_BASE_PATH
    const updates: Record<string, string> = {};
    if (preEnv.MESSENGER && preEnv.MESSENGER.includes(",")) {
      updates.MESSENGER = preEnv.MESSENGER.split(",")[0].trim();
    }
    // Rewrite env file, dropping REPOS_BASE_PATH entirely if present
    if (preEnv.REPOS_BASE_PATH) {
      const envPath = path.join(solosquad, ".env");
      if (fs.existsSync(envPath)) {
        const filtered = normalizeLine(fs.readFileSync(envPath, "utf-8"))
          .split("\n")
          .filter((line) => {
            const trimmed = line.trim();
            return !trimmed.startsWith("REPOS_BASE_PATH=");
          })
          .join("\n");
        fs.writeFileSync(envPath, filtered);
      }
    }
    if (Object.keys(updates).length) {
      saveEnv(updates, workspace);
    }

    // 5. workspace.yaml
    const workspaceYaml = {
      version: TARGET,
      display_name: path.basename(workspace),
      persona: "personal",
      created_at: new Date().toISOString(),
      last_migrated_to: TARGET,
    };
    fs.writeFileSync(
      path.join(solosquad, "workspace.yaml"),
      yaml.dump(workspaceYaml, { lineWidth: 100 })
    );
  },

  async verify(workspace: string): Promise<VerifyResult> {
    const solosquad = path.join(workspace, ".solosquad");
    if (!dirExists(solosquad)) {
      return { ok: false, error: ".solosquad/ directory not created" };
    }
    if (!fs.existsSync(path.join(solosquad, "workspace.yaml"))) {
      return { ok: false, error: "workspace.yaml not created" };
    }
    // At least one of the moved dirs should now live under .solosquad/
    const any = ROOT_CONFIG_DIRS.some((d) =>
      dirExists(path.join(solosquad, d))
    );
    if (!any) {
      return { ok: false, error: "No config directories found under .solosquad/" };
    }
    // Legacy dirs should be gone
    for (const d of ROOT_CONFIG_DIRS) {
      if (dirExists(path.join(workspace, d))) {
        return { ok: false, error: `Legacy ${d}/ still present at workspace root` };
      }
    }
    return { ok: true };
  },
};

// Prevent unused-var warning when the module is imported for side-effects
export const _platforms = MESSENGER_PLATFORMS;
