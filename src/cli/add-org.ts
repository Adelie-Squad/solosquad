import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { getWorkspaceRoot } from "../util/paths.js";
import { loadEnv, loadWorkspaceYaml, normalizeMessenger, type OrgYaml } from "../util/config.js";
import { scaffoldOrg, slugify } from "../util/scaffold.js";

export interface AddOrgOpts {
  provider?: OrgYaml["provider"];
  remoteUrl?: string;
  messenger?: string;
}

const PROVIDERS: OrgYaml["provider"][] = ["local", "github", "gitlab", "gitea"];

export async function addOrgCommand(
  nameArg: string | undefined,
  opts: AddOrgOpts
): Promise<void> {
  const workspace = getWorkspaceRoot();
  const ws = loadWorkspaceYaml(workspace);
  if (!ws) {
    console.log(chalk.red("✗ Not inside a SoloSquad workspace. Run `solosquad init` first."));
    process.exit(1);
  }

  let name = nameArg;
  if (!name) {
    const answer = await inquirer.prompt([
      { name: "name", type: "input", message: "Organization name:" },
    ]);
    name = answer.name;
  }
  if (!name) {
    console.log(chalk.red("✗ Organization name is required."));
    process.exit(1);
  }

  const slug = slugify(name);
  const orgDir = path.join(workspace, slug);
  if (fs.existsSync(orgDir)) {
    console.log(chalk.red(`✗ ${slug}/ already exists at workspace root.`));
    process.exit(1);
  }

  let provider = opts.provider;
  let remoteUrl = opts.remoteUrl;
  if (!provider) {
    const a = await inquirer.prompt([
      {
        name: "provider",
        type: "list",
        message: "Provider:",
        choices: PROVIDERS,
        default: "github",
      },
    ]);
    provider = a.provider;
  } else if (!PROVIDERS.includes(provider)) {
    console.log(chalk.red(`✗ Unknown provider: ${provider}. One of: ${PROVIDERS.join(", ")}`));
    process.exit(1);
  }
  if (remoteUrl === undefined) {
    const a = await inquirer.prompt([
      { name: "remoteUrl", type: "input", message: "Remote URL (blank to skip):", default: "" },
    ]);
    remoteUrl = a.remoteUrl;
  }

  const env = loadEnv(workspace);
  const messenger = normalizeMessenger(opts.messenger ?? env.MESSENGER);

  const { orgDir: created } = scaffoldOrg({
    workspace,
    name,
    slug,
    provider: provider as OrgYaml["provider"],
    remoteUrl: remoteUrl || null,
    messenger,
  });

  console.log(chalk.green(`✓ ${path.basename(created)}/ created`));
  console.log(chalk.dim("  Next: add repos with `solosquad add repo <url|path>` or clone into"));
  console.log(chalk.dim(`        ${path.basename(created)}/repositories/ and run \`solosquad sync\`.`));
}
