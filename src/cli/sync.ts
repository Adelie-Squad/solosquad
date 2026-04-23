import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { RESERVED_ORG_CHILDREN, getWorkspaceRoot } from "../util/paths.js";
import {
  listOrganizations,
  loadOrgYaml,
  loadRepoYaml,
  loadWorkspaceYaml,
  saveOrgYaml,
} from "../util/config.js";
import { scaffoldRepoYaml } from "../util/scaffold.js";
import { isGitRepo } from "../util/git.js";

export interface SyncOpts {
  org?: string;
  dryRun?: boolean;
  skipLegacyPrompt?: boolean;
}

interface OrgScanResult {
  orgSlug: string;
  orgDir: string;
  added: string[];
  existing: string[];
  missing: string[];
  nonRepoFolders: string[];
  legacyDetected: boolean;
}

async function handleLegacyOrg(orgDir: string, orgSlug: string, opts: SyncOpts): Promise<boolean> {
  if (opts.skipLegacyPrompt) return false;

  console.log(
    chalk.yellow(
      `\n⚠ ${orgSlug}/ has a .git folder at the organization root (v1.1.x legacy layout).`
    )
  );
  console.log(chalk.dim(
    "  The org is currently acting as a single repository. If you plan to add more repos\n" +
    "  under this org later, normalizing now avoids a messy mix."
  ));

  const { choice } = await inquirer.prompt([
    {
      name: "choice",
      type: "list",
      message: "How would you like to handle this?",
      choices: [
        { name: "Normalize — move code into repositories/<org-slug>/ (recommended)", value: "normalize" },
        { name: "Keep legacy — register repo.yaml at org root, skip restructure", value: "keep" },
      ],
      default: "normalize",
    },
  ]);

  if (choice === "keep") {
    if (opts.dryRun) {
      console.log(chalk.dim("  [dry-run] Would create .solosquad/repo.yaml at org root."));
      return false;
    }
    scaffoldRepoYaml({
      orgDir,
      orgSlug,
      repoDir: orgDir,
      slug: orgSlug,
      role: "main",
    });
    console.log(chalk.green(`  ✓ ${orgSlug}/.solosquad/repo.yaml written (legacy mode)`));
    return false;
  }

  // Normalize
  const reposDir = path.join(orgDir, "repositories");
  const target = path.join(reposDir, orgSlug);
  if (fs.existsSync(target)) {
    console.log(chalk.red(`  ✗ Destination ${target} already exists. Resolve manually.`));
    return false;
  }

  if (opts.dryRun) {
    console.log(chalk.dim(`  [dry-run] Would move org-root files + .git into ${target}/`));
    return true;
  }

  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(orgDir, { withFileTypes: true })) {
    // Keep system folders and .org.yaml in place; move everything else (incl. .git) into the new repo dir.
    if (RESERVED_ORG_CHILDREN.has(entry.name)) continue;
    const src = path.join(orgDir, entry.name);
    const dst = path.join(target, entry.name);
    fs.renameSync(src, dst);
  }
  console.log(chalk.green(`  ✓ Moved org-root contents into ${orgSlug}/repositories/${orgSlug}/`));
  return true;
}

async function scanOrg(orgSlug: string, orgDir: string, opts: SyncOpts): Promise<OrgScanResult> {
  const result: OrgScanResult = {
    orgSlug,
    orgDir,
    added: [],
    existing: [],
    missing: [],
    nonRepoFolders: [],
    legacyDetected: fs.existsSync(path.join(orgDir, ".git")),
  };

  if (result.legacyDetected) {
    const converted = await handleLegacyOrg(orgDir, orgSlug, opts);
    if (converted) {
      result.added.push(orgSlug);
    }
  }

  const reposDir = path.join(orgDir, "repositories");
  if (!fs.existsSync(reposDir)) {
    fs.mkdirSync(reposDir, { recursive: true });
  }

  for (const entry of fs.readdirSync(reposDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const repoDir = path.join(reposDir, entry.name);
    const existingYaml = loadRepoYaml(repoDir);

    if (!isGitRepo(repoDir)) {
      if (existingYaml) {
        result.existing.push(entry.name);
      } else {
        result.nonRepoFolders.push(entry.name);
      }
      continue;
    }

    if (existingYaml) {
      result.existing.push(entry.name);
      continue;
    }

    if (opts.dryRun) {
      result.added.push(entry.name);
      continue;
    }

    scaffoldRepoYaml({
      orgDir,
      orgSlug,
      repoDir,
      slug: entry.name,
      role: "main",
    });
    result.added.push(entry.name);
  }

  // Reconcile .org.yaml.products[].repos with actual files present
  if (!opts.dryRun) {
    const org = loadOrgYaml(orgDir);
    if (org) {
      const presentSlugs = new Set(result.existing.concat(result.added));
      if (org.products && org.products.length > 0) {
        for (const p of org.products) {
          p.repos = Array.from(presentSlugs).sort();
        }
      } else {
        org.products = [
          {
            name: org.name,
            slug: org.slug,
            description: "",
            repos: Array.from(presentSlugs).sort(),
          },
        ];
      }
      saveOrgYaml(orgDir, org);
    }
  }

  // Detect repos referenced in .org.yaml but missing on disk
  const org = loadOrgYaml(orgDir);
  if (org?.products) {
    const presentSlugs = new Set(result.existing.concat(result.added));
    for (const p of org.products) {
      for (const r of p.repos ?? []) {
        if (!presentSlugs.has(r)) result.missing.push(r);
      }
    }
  }

  return result;
}

export async function syncCommand(opts: SyncOpts): Promise<void> {
  const workspace = getWorkspaceRoot();
  const ws = loadWorkspaceYaml(workspace);
  if (!ws) {
    console.log(chalk.red("✗ Not inside a SoloSquad workspace. Run `solosquad init` first."));
    process.exit(1);
  }

  const allOrgs = listOrganizations(workspace);
  if (allOrgs.length === 0) {
    console.log(chalk.yellow("No organizations found. Nothing to sync."));
    return;
  }

  const targets = opts.org ? allOrgs.filter((o) => o.slug === opts.org) : allOrgs;
  if (opts.org && targets.length === 0) {
    console.log(chalk.red(`✗ Unknown org: ${opts.org}`));
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(chalk.dim("[dry-run] No changes will be written.\n"));
  }

  for (const o of targets) {
    console.log(chalk.bold(`\n${o.slug}/`));
    const res = await scanOrg(o.slug, o.path, opts);
    if (res.existing.length) {
      for (const s of res.existing) console.log(chalk.dim(`  = ${s}   (already registered)`));
    }
    if (res.added.length) {
      for (const s of res.added) console.log(chalk.green(`  + ${s}   (registered)`));
    }
    if (res.nonRepoFolders.length) {
      for (const s of res.nonRepoFolders) console.log(chalk.yellow(`  ? ${s}   (no .git — skipped)`));
    }
    if (res.missing.length) {
      for (const s of res.missing) console.log(chalk.red(`  - ${s}   (listed in .org.yaml but missing on disk)`));
    }
    if (!res.existing.length && !res.added.length && !res.nonRepoFolders.length) {
      console.log(chalk.dim("  (empty — clone a repo into repositories/ then re-run sync)"));
    }
  }
}
