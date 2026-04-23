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

export interface AddRepoOpts {
  org?: string;
  role?: RepoYaml["role"];
  slug?: string;
}

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
  fs.mkdirSync(reposDir, { recursive: true });

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
        const { confirm } = await inquirer.prompt([
          {
            name: "confirm",
            type: "confirm",
            message: `Move ${src} → ${repoDir} ?`,
            default: true,
          },
        ]);
        if (!confirm) {
          console.log(chalk.yellow("Aborted."));
          return;
        }
        fs.renameSync(src, repoDir);
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
}
