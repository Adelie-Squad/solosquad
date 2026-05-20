import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { getWorkspaceRoot } from "../util/paths.js";
import {
  listOrganizations,
  loadOrgYaml,
  loadWorkspaceYaml,
  saveOrgYaml,
  type RepoYaml,
} from "../util/config.js";
import { scaffoldRepoYaml } from "../util/scaffold.js";
import { cloneRepo, isGitRepo, looksLikeGitUrl, slugFromUrl } from "../util/git.js";
import { applyReport, type MergePolicy } from "../analyze/applier.js";
import { rebuildRoutes } from "../bot/agent-router.js";
import { formatInspectionReport, inspectRepo } from "../util/repo-inspect.js";
import { warnDeprecated } from "../util/deprecation.js";

export interface AddRepoOpts {
  org?: string;
  role?: RepoYaml["role"];
  slug?: string;
  /** v0.5 §6.5 — apply a previously generated analyze report. */
  fromReport?: string;
  /** v0.5 §6.5 — merge strategy for role-label files landing in user agents. */
  mergePolicy?: MergePolicy;
  /** v0.8.3 §3 — simulate the move; no disk writes. */
  dryRun?: boolean;
  /** v0.8.3 §3 — alias for --dry-run. */
  inspect?: boolean;
  /** v0.8.3 §3 — copy the repo instead of moving (preserves original on disk). */
  keepOriginal?: boolean;
  /**
   * v0.9.0 — register an external path as a path-reference. No move, no copy.
   * Workspace stores only a `<workspace>/<org>/repositories/<slug>.yaml` file
   * (not a directory) with the absolute `path` field. The agent's spawn cwd
   * resolves to this external path via `resolveRepoCwd` (paths.ts).
   *
   * When this option is set (or when cwd is a git repo and [input] is
   * omitted), the legacy move/copy flow is skipped.
   */
  path?: string;
}

const MERGE_POLICIES: MergePolicy[] = ["append", "override", "replace"];

const ROLES: RepoYaml["role"][] = ["main", "frontend", "backend", "data", "infra", "docs", "unknown"];

async function pickOrgSlug(workspace: string, explicit?: string): Promise<string> {
  const orgs = listOrganizations(workspace);
  if (orgs.length === 0) {
    console.log(chalk.red("✗ No organizations found. Run `solosquad add org <name>` first."));
    process.exit(1);
  }
  if (explicit) {
    const match = orgs.find((o) => o.slug === explicit);
    if (!match) {
      console.log(chalk.red(`✗ Unknown org: ${explicit}. Available: ${orgs.map((o) => o.slug).join(", ")}`));
      process.exit(1);
    }
    return match.slug;
  }

  // Auto: single org → pick it
  if (orgs.length === 1) return orgs[0].slug;

  // cwd inside an org? → pick it
  const cwd = path.resolve(process.cwd());
  const inOrg = orgs.find((o) => cwd === o.path || cwd.startsWith(o.path + path.sep));
  if (inOrg) return inOrg.slug;

  // Ask
  const { org } = await inquirer.prompt([
    {
      name: "org",
      type: "list",
      message: "Which organization?",
      choices: orgs.map((o) => ({ name: o.slug, value: o.slug })),
    },
  ]);
  return org;
}

async function confirmRole(defaultRole: RepoYaml["role"], explicit?: RepoYaml["role"]): Promise<RepoYaml["role"]> {
  if (explicit) {
    if (!ROLES.includes(explicit)) {
      console.log(chalk.red(`✗ Unknown role: ${explicit}. One of: ${ROLES.join(", ")}`));
      process.exit(1);
    }
    return explicit;
  }
  const { role } = await inquirer.prompt([
    {
      name: "role",
      type: "list",
      message: "Role:",
      choices: ROLES,
      default: defaultRole,
    },
  ]);
  return role as RepoYaml["role"];
}

/** Update `.org.yaml.products[].repos` to include the new repo slug (under a default product if needed). */
function linkRepoToOrg(orgDir: string, repoSlug: string): void {
  const org = loadOrgYaml(orgDir);
  if (!org) return;
  org.products = org.products ?? [];
  if (org.products.length === 0) {
    org.products.push({
      name: org.name,
      slug: org.slug,
      description: "",
      repos: [repoSlug],
    });
  } else {
    const first = org.products[0];
    first.repos = first.repos ?? [];
    if (!first.repos.includes(repoSlug)) first.repos.push(repoSlug);
  }
  saveOrgYaml(orgDir, org);
}

export async function addRepoCommand(input: string | undefined, opts: AddRepoOpts): Promise<void> {
  const workspace = getWorkspaceRoot();
  const ws = loadWorkspaceYaml(workspace);
  if (!ws) {
    console.log(chalk.red("✗ Not inside a SoloSquad workspace. Run `solosquad init` first."));
    process.exit(1);
  }

  // v0.9.0 — path-reference auto-detection.
  // If --path is set, OR if [input] is omitted and cwd happens to be a git
  // repo, take the path-reference flow (no move, no copy).
  const cwdIsRepo = !input && !opts.path && isGitRepo(process.cwd());
  if (opts.path || cwdIsRepo) {
    const externalPath = path.resolve(opts.path ?? process.cwd());
    return registerPathReference(workspace, externalPath, opts);
  }

  if (!input) {
    const a = await inquirer.prompt([
      {
        name: "input",
        type: "input",
        message: "Git URL or local path to the repo:",
      },
    ]);
    input = a.input;
  }
  if (!input) {
    console.log(chalk.red("✗ URL or path required."));
    process.exit(1);
  }

  const orgSlug = await pickOrgSlug(workspace, opts.org);
  const orgDir = path.join(workspace, orgSlug);
  const reposDir = path.join(orgDir, "repositories");
  if (opts.inspect) {
    warnDeprecated({ oldName: "--inspect", newName: "--dry-run" });
  }
  const dryRun = opts.dryRun || opts.inspect;
  if (!dryRun) {
    fs.mkdirSync(reposDir, { recursive: true });
  }

  // v0.8.3 §3 — dry-run / --inspect: for a local path, print the
  // inspection report and exit *without* touching disk. For a git URL we
  // can still describe the destination + run a slug-collision check, but
  // not file stats (we'd need to clone first).
  if (dryRun) {
    const isUrl = looksLikeGitUrl(input);
    const guessedSlug = opts.slug ?? (isUrl ? slugFromUrl(input) : path.basename(path.resolve(input)));
    const destination = path.join(reposDir, guessedSlug);
    if (isUrl) {
      console.log(chalk.bold(`\n[dry-run] add repo (git URL)`));
      console.log(`From: ${input}`);
      console.log(`To:   ${destination}`);
      const exists = fs.existsSync(destination);
      console.log(`Slug collision: ${exists ? `${destination} already exists` : "none"}`);
      console.log(chalk.dim(`(file stats unavailable for remote URLs — clone first to inspect contents)`));
      console.log(chalk.bold(`\nNo files moved (dry-run).`));
      return;
    }
    const src = path.resolve(input);
    if (!fs.existsSync(src)) {
      console.log(chalk.red(`✗ Path does not exist: ${src}`));
      process.exit(1);
    }
    const report = inspectRepo(src, { reposDir, slug: guessedSlug });
    console.log(chalk.bold(`\n[dry-run] add repo`));
    console.log(
      formatInspectionReport(report, {
        destination,
        addedFile: `<repo>/.solosquad/repo.yaml`,
      }),
    );
    console.log(chalk.bold(`\nNo files moved (dry-run).`));
    return;
  }

  let repoDir: string;
  let slug: string;
  try {
    if (looksLikeGitUrl(input)) {
      slug = opts.slug ?? slugFromUrl(input);
      repoDir = path.join(reposDir, slug);
      if (fs.existsSync(repoDir)) {
        console.log(chalk.yellow(`! ${slug} already exists at destination. Skipping clone, proceeding to register.`));
      } else {
        console.log(chalk.dim(`Cloning ${input} → ${path.relative(process.cwd(), repoDir)}...`));
        cloneRepo(input, repoDir);
      }
    } else {
      const src = path.resolve(input);
      if (!fs.existsSync(src)) {
        console.log(chalk.red(`✗ Path does not exist: ${src}`));
        process.exit(1);
      }
      slug = opts.slug ?? path.basename(src);
      repoDir = path.join(reposDir, slug);

      if (path.resolve(repoDir) === src) {
        // Already at the canonical location — just register.
      } else if (fs.existsSync(repoDir)) {
        console.log(chalk.red(`✗ Destination already exists: ${repoDir}. Move it manually or pick --slug.`));
        process.exit(1);
      } else {
        const action = opts.keepOriginal ? "Copy" : "Move";
        const { confirm } = await inquirer.prompt([
          {
            name: "confirm",
            type: "confirm",
            message: `${action} ${src} → ${repoDir} ?`,
            default: true,
          },
        ]);
        if (!confirm) {
          console.log(chalk.yellow("Aborted."));
          return;
        }
        if (opts.keepOriginal) {
          copyDirRecursive(src, repoDir);
        } else {
          fs.renameSync(src, repoDir);
        }
      }
    }
  } catch (err) {
    console.log(chalk.red(`✗ ${(err as Error).message}`));
    process.exit(1);
  }

  const defaultRole: RepoYaml["role"] = isGitRepo(repoDir) ? "main" : "unknown";
  const role = await confirmRole(defaultRole, opts.role);

  const doc = scaffoldRepoYaml({ orgDir, orgSlug, repoDir, role, slug });
  linkRepoToOrg(orgDir, doc.slug);

  console.log(chalk.green(`✓ ${orgSlug}/repositories/${doc.slug} registered (role: ${doc.role})`));
  if (doc.remote_url) console.log(chalk.dim(`  remote: ${doc.remote_url}`));
  if (doc.language) console.log(chalk.dim(`  language: ${doc.language}`));

  if (opts.fromReport) {
    if (opts.mergePolicy && !MERGE_POLICIES.includes(opts.mergePolicy)) {
      console.log(
        chalk.red(
          `✗ Unknown --merge-policy: ${opts.mergePolicy}. One of: ${MERGE_POLICIES.join(", ")}`
        )
      );
      process.exit(1);
    }
    const reportAbs = path.isAbsolute(opts.fromReport)
      ? opts.fromReport
      : path.resolve(repoDir, opts.fromReport);
    if (!fs.existsSync(reportAbs)) {
      console.log(chalk.red(`✗ Report file not found: ${reportAbs}`));
      process.exit(1);
    }
    console.log(chalk.cyan(`Applying analyze report: ${reportAbs}`));
    const result = await applyReport({
      repo_root: repoDir,
      org_slug: orgSlug,
      workspace_root: workspace,
      merge_policy: opts.mergePolicy ?? "append",
      verify: () => {
        try {
          rebuildRoutes({ org: orgSlug });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },
    });
    if (result.rolled_back) {
      console.log(
        chalk.red(
          `✗ Applier rolled back: ${result.error ?? "verify failed"} (backup: ${result.backup_dir})`
        )
      );
      process.exit(1);
    }
    console.log(
      chalk.green(
        `✓ Applied ${result.applied_count} entr${result.applied_count === 1 ? "y" : "ies"} (skipped ${result.skipped_count})`
      )
    );
    console.log(chalk.dim(`  backup: ${result.backup_dir}`));
  }
}

/**
 * v0.9.0 — register an external path as a path-reference. No move, no copy.
 *
 * Disk effects (all class A* per v0.7 inviolability — only files SoloSquad
 * creates on disk inside the external repo are these two):
 * 1. `<workspace>/<org>/repositories/<slug>.yaml` — workspace-side metadata
 *    (slug, role, language, remote_url, registered_at, **path: <external>**).
 *    *File* (not a directory).
 * 2. `<external>/.solosquad/repo.yaml` — repo-side metadata (same fields).
 *    Lets the external repo "know" it's linked to a SoloSquad org.
 *
 * Spawn cwd resolution: `resolveRepoCwd` reads (1) and returns the external
 * path. See `src/util/paths.ts:resolveRepoCwd`.
 *
 * Plan: `docs/plan/v0.9-workspace-repo-relationship.md` §7 + §13.
 */
async function registerPathReference(
  workspace: string,
  externalPath: string,
  opts: AddRepoOpts,
): Promise<void> {
  if (!fs.existsSync(externalPath)) {
    console.log(chalk.red(`✗ External path does not exist: ${externalPath}`));
    process.exit(1);
  }
  if (!isGitRepo(externalPath)) {
    console.log(chalk.red(`✗ Not a git repo (no .git/): ${externalPath}`));
    console.log(
      chalk.dim(
        "  path-reference requires a git repo at the external path. " +
          "Either initialize one (`git init`), or use legacy mode (move/clone).",
      ),
    );
    process.exit(1);
  }

  const orgSlug = await pickOrgSlug(workspace, opts.org);
  const orgDir = path.join(workspace, orgSlug);
  const reposDir = path.join(orgDir, "repositories");

  const slug = opts.slug ?? path.basename(externalPath);
  const yamlPath = path.join(reposDir, `${slug}.yaml`);

  if (opts.dryRun || opts.inspect) {
    if (opts.inspect) warnDeprecated({ oldName: "--inspect", newName: "--dry-run" });
    console.log(chalk.bold(`\n[dry-run] register path-reference`));
    console.log(`  external path: ${externalPath}`);
    console.log(`  org:           ${orgSlug}`);
    console.log(`  slug:          ${slug}`);
    console.log(`  workspace ref: ${yamlPath}`);
    console.log(`  repo metadata: ${path.join(externalPath, ".solosquad", "repo.yaml")}`);
    console.log(chalk.bold(`\nNo files written (dry-run).`));
    return;
  }

  // Refuse overwriting existing legacy tree at same slug.
  const legacyDir = path.join(reposDir, slug);
  if (fs.existsSync(legacyDir)) {
    console.log(
      chalk.red(
        `✗ A legacy repositories/${slug}/ directory already exists. ` +
          `Pick a different --slug, or remove the legacy tree first.`,
      ),
    );
    process.exit(1);
  }
  if (fs.existsSync(yamlPath)) {
    console.log(
      chalk.red(
        `✗ Already registered: ${yamlPath}. Use a different --slug or delete the existing yaml.`,
      ),
    );
    process.exit(1);
  }

  const defaultRole: RepoYaml["role"] = "main";
  const role = await confirmRole(defaultRole, opts.role);

  // Write the two yamls — one in workspace, one in the external repo.
  fs.mkdirSync(reposDir, { recursive: true });
  const yaml = await import("js-yaml");
  const { detectLanguage, getRemoteUrl } = await import("../util/git.js");
  const remoteUrl = getRemoteUrl(externalPath);
  const language = detectLanguage(externalPath);
  const doc: RepoYaml = {
    slug,
    name: slug,
    role,
    language: language ?? undefined,
    linked_org: orgSlug,
    remote_url: remoteUrl,
    products: [],
    registered_at: new Date().toISOString(),
    path: externalPath,
  };
  fs.writeFileSync(yamlPath, yaml.dump(doc, { lineWidth: 100 }), "utf-8");

  // Write a mirror at the external repo (class A* — single file inside user code).
  const repoSolosquadDir = path.join(externalPath, ".solosquad");
  fs.mkdirSync(repoSolosquadDir, { recursive: true });
  const externalYamlPath = path.join(repoSolosquadDir, "repo.yaml");
  if (!fs.existsSync(externalYamlPath)) {
    fs.writeFileSync(externalYamlPath, yaml.dump(doc, { lineWidth: 100 }), "utf-8");
  }

  linkRepoToOrg(orgDir, slug);

  console.log(chalk.green(`✓ ${orgSlug}/${slug} registered as path-reference`));
  console.log(chalk.dim(`  external path: ${externalPath}`));
  console.log(chalk.dim(`  workspace ref: ${path.relative(workspace, yamlPath)}`));
  if (remoteUrl) console.log(chalk.dim(`  remote:        ${remoteUrl}`));
  if (language) console.log(chalk.dim(`  language:      ${language}`));
}

/**
 * v0.8.3 §3 — recursive copy used by `--keep-original`. Preserves regular
 * files + directories + symlinks; skips device nodes. Uses Node 16+
 * `fs.cpSync` when available; falls back to a manual walker otherwise.
 */
function copyDirRecursive(src: string, dest: string): void {
  type CpFn = (s: string, d: string, opts: Record<string, unknown>) => void;
  const cpSync = (fs as unknown as { cpSync?: CpFn }).cpSync;
  if (cpSync) {
    cpSync(src, dest, { recursive: true, errorOnExist: false });
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dest, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(sp);
      fs.symlinkSync(target, dp);
    } else if (entry.isDirectory()) {
      copyDirRecursive(sp, dp);
    } else if (entry.isFile()) {
      fs.copyFileSync(sp, dp);
    }
  }
}
