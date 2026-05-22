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
import { isGitRepo, looksLikeGitUrl, slugFromUrl } from "../util/git.js";
import { applyReport, type MergePolicy } from "../analyze/applier.js";
import { rebuildRoutes } from "../bot/agent-router.js";
import { inspectRepo, formatInspectionReport } from "../util/repo-inspect.js";
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
   * v0.9.1 — register an external path as a path-reference. No move, no copy.
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

/**
 * v1.0.1 — repo `role` is deprecated. Registration no longer prompts;
 * default is "main" silently. `--role <value>` is still accepted as a
 * power-user override (validated against ROLES) but emits a deprecation
 * warning. See RepoYaml.role JSDoc in `src/util/config.ts`.
 */
function resolveRole(explicit?: RepoYaml["role"]): RepoYaml["role"] {
  if (!explicit) return "main";
  if (!ROLES.includes(explicit)) {
    console.log(chalk.red(`✗ Unknown role: ${explicit}. One of: ${ROLES.join(", ")}`));
    process.exit(1);
  }
  warnDeprecated({
    oldName: "--role",
    newName:
      "(no-op — repo role is deprecated since v1.0.1; multi-repo intent now uses @<slug> mention or PM clarifying question)",
  });
  return explicit;
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

  // v1.0 — path-reference is the only registration mode. URL clone + Move/Copy
  // into the workspace tree were removed; SoloSquad does not own git clone
  // semantics (auth / branch / depth / submodules / LFS). Use your own git
  // toolchain to clone, then re-run with the local path.
  if (input && looksLikeGitUrl(input)) {
    const suggestedSlug = opts.slug ?? slugFromUrl(input);
    console.log(chalk.red(`✗ Git URL is not accepted in v1.0 path-reference mode.`));
    console.log(
      chalk.dim(
        `  Clone the repo locally first with your own git toolchain, then re-add the path.\n` +
          `  Example:  git clone ${input} ~/code/${suggestedSlug}\n` +
          `            solosquad add repo ~/code/${suggestedSlug}`,
      ),
    );
    process.exit(1);
  }

  // Resolve the external path: explicit --path > positional [input] > cwd (if
  // it's a git repo). Everything funnels into the path-reference flow.
  let externalPath: string | undefined;
  if (opts.path) {
    externalPath = path.resolve(opts.path);
  } else if (input) {
    externalPath = path.resolve(input);
  } else if (isGitRepo(process.cwd())) {
    externalPath = path.resolve(process.cwd());
  } else {
    const a = await inquirer.prompt([
      {
        name: "input",
        type: "input",
        message: "Local path to an existing git repo:",
      },
    ]);
    if (!a.input) {
      console.log(chalk.red("✗ Local path is required."));
      process.exit(1);
    }
    externalPath = path.resolve(a.input);
  }

  if (opts.inspect) {
    warnDeprecated({ oldName: "--inspect", newName: "--dry-run" });
  }
  if (opts.keepOriginal) {
    warnDeprecated({
      oldName: "--keep-original",
      newName: "(no-op — v1.0 always uses path-reference, original is never moved)",
    });
  }

  await registerPathReference(workspace, externalPath, opts);

  if (opts.fromReport) {
    const orgSlug = await pickOrgSlug(workspace, opts.org);
    const orgDir = path.join(workspace, orgSlug);
    const repoDir = externalPath;
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
 * v0.9.1 — register an external path as a path-reference. No move, no copy.
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
 * Plan: `docs/plan/v0.9.1-workspace-repo-relationship.md` §7 + §13.
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
    const report = inspectRepo(externalPath, { reposDir, slug });
    console.log(
      "\n" +
        formatInspectionReport(report, {
          destination: externalPath,
          addedFile: `<repo>/.solosquad/repo.yaml`,
        }),
    );
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

  const role = resolveRole(opts.role);

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

// v1.0 — copyDirRecursive removed (was used by --keep-original which is
// now a deprecated no-op since path-reference never copies).
