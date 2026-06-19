import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { getWorkspaceRoot } from "../util/paths.js";
import { loadEnv, loadWorkspaceYaml, normalizeMessenger, type OrgYaml } from "../util/config.js";
import { scaffoldOrg, slugify } from "../util/scaffold.js";
import { syncAgentsToOrg } from "../bot/agents-builder.js";
import {
  buildInviteUrl,
  openInBrowser,
} from "../messenger/discord-invite-url.js";
import { listAllUsers } from "../bot/user-registry.js";

export interface AddOrgOpts {
  provider?: OrgYaml["provider"];
  remoteUrl?: string;
  messenger?: string;
  /** v1.2 — non-interactive Chief name override. */
  chiefName?: string;
  /** v1.2 — skip the Discord invite-URL offer at the end. */
  skipDiscord?: boolean;
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

  // v1.2 §4.1 — Chief name (org-scoped). v1.2.4 §B.3 — copy 보강.
  // Skip = runtime fallback "Chief".
  let chiefName = opts.chiefName?.trim();
  if (chiefName === undefined) {
    console.log(
      chalk.bold("\n  💡 Chief 이름 — 조직 1개당 1명, 사용자 대면 supervisor"),
    );
    console.log(
      chalk.dim(
        "  Chief 는 사용자가 메신저에서 직접 대화하는 유일한 에이전트입니다.\n" +
          "  4 main bot (pm / engineer / designer / marketer) + 20 specialist 를\n" +
          "  내부적으로 spawn 해서 결과를 합성 → 사용자에게는 *Chief 1명* 으로 보임.\n" +
          "\n  이름은 다음 6곳에 노출됩니다:\n" +
          "    • 봇 응답 prefix             [Hermes]\n" +
          "    • Discord onboarding embed   안녕하세요, Hermes 입니다 🫡\n" +
          "    • works 채널 task card       Hermes · Chief\n" +
          "    • owner-only 안내 메시지      Hermes only takes commands from @you\n" +
          "    • doctor / log 출력\n" +
          "    • Discord Developer Portal Bot 이름 권장 동일\n" +
          "\n  추천 예시: Hermes, Atlas, Apollo, Iris, Janus, Athena, Hephaestus.",
      ),
    );
    const answer = await inquirer.prompt([
      {
        name: "chiefName",
        type: "input",
        message: "Chief name (blank = use default \"Chief\"):",
        default: "",
      },
    ]);
    chiefName = (answer.chiefName as string).trim() || undefined;
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
    chiefName,
  });

  // Sync the bundled agent roster into <org>/.claude/agents/ so Claude
  // Code's Task tool can find specialists. Without this, the org's
  // agent list comes up empty after install — historically only the
  // v0.2.4→v0.3.0 migration did this sync, and no other code path
  // re-ran it for orgs added later.
  let syncedAgents = 0;
  try {
    syncedAgents = syncAgentsToOrg(workspace, slug).length;
  } catch (err) {
    console.log(
      chalk.yellow(
        `⚠ Agent sync failed: ${(err as Error).message}. Run \`solosquad sync\` to retry.`
      )
    );
  }

  console.log(chalk.green(`✓ ${path.basename(created)}/ created`));
  if (chiefName) {
    console.log(chalk.dim(`  chief: ${chalk.cyan(chiefName)}`));
  }
  if (syncedAgents > 0) {
    console.log(chalk.dim(`  synced ${syncedAgents} agents into .claude/agents/`));
  }
  console.log(chalk.dim("  hierarchy: agents/main/chief, teams/{product,engineering,design,marketing},"));
  console.log(chalk.dim("             memory/{cron-logs,open-questions,ledger},"));
  console.log(chalk.dim("             workflows/problem-definition (default workflow seed)"));

  // v1.2 §5.5 Step 4 — optional inline Discord connect. If the workspace
  // has at least one registered Discord bot (= bot_application_id known),
  // offer to print/open the invite URL right now so the new org's Chief
  // can be added to a fresh guild in one click. Skipped when:
  //   - opts.skipDiscord is set (non-interactive flows)
  //   - messenger is not discord
  //   - no bot_application_id available (user hasn't run init/messenger setup)
  if (!opts.skipDiscord && messenger === "discord") {
    await offerDiscordInvite(workspace);
  }

  console.log(chalk.dim("  Next: add repos with `solosquad add repo <url|path>` or clone into"));
  console.log(chalk.dim(`        ${path.basename(created)}/repositories/ and run \`solosquad sync\`.`));
}

async function offerDiscordInvite(workspace: string): Promise<void> {
  const users = listAllUsers(workspace);
  const discordUsers = users.filter((u) => u.user.messenger === "discord");
  const appIds = Array.from(
    new Set(
      discordUsers
        .map((u) => u.user.bot_application_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  );
  if (appIds.length === 0) {
    console.log(
      chalk.dim(
        "  (Discord bot not yet registered — run `solosquad init` or `solosquad doctor --discord` to connect a bot,",
      ),
    );
    console.log(
      chalk.dim(
        "   then `solosquad discord invite-url` to add it to this org's guild.)",
      ),
    );
    return;
  }

  const { wantInvite } = await inquirer.prompt([
    {
      name: "wantInvite",
      type: "confirm",
      message: "Generate a Discord invite URL for this org now?",
      default: true,
    },
  ]);
  if (!wantInvite) return;

  let clientId = appIds[0];
  if (appIds.length > 1) {
    const answer = await inquirer.prompt([
      {
        name: "appId",
        type: "list",
        message: "Which Discord application?",
        choices: discordUsers
          .filter((u) =>
            typeof u.user.bot_application_id === "string" &&
            u.user.bot_application_id.length > 0,
          )
          .map((u) => ({
            name: `${u.user.bot_application_id}  (${u.orgSlug} / ${u.user.handle})`,
            value: u.user.bot_application_id!,
          })),
      },
    ]);
    clientId = answer.appId;
  }

  try {
    const url = buildInviteUrl({ applicationClientId: clientId });
    console.log("");
    console.log(chalk.green("✓ Discord invite URL"));
    console.log(chalk.cyan(`  ${url}`));
    if (openInBrowser(url)) {
      console.log(chalk.dim("  → opened in your default browser"));
    } else {
      console.log(
        chalk.yellow(
          "  ⚠ Could not launch a browser automatically — copy the URL above manually.",
        ),
      );
    }
  } catch (err) {
    console.log(chalk.yellow(`  ⚠ Invite URL synthesis failed: ${(err as Error).message}`));
  }
}
