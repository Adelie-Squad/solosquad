import path from "path";
import * as readline from "readline";
import { RealClaudeProcessFactory } from "../bot/claude-process.js";
import { ChiefRunner } from "../bot/chief-runner.js";
import { SessionStore } from "../bot/session-store.js";
import { FileEventSink, pmEventsPath } from "../bot/events.js";
import { getWorkspaceDir, getOrgDir } from "../util/paths.js";
import { listOrganizations, loadOrgYaml } from "../util/config.js";

/**
 * v1.2.9 §D — `solosquad chat`: talk to Chief from the terminal, without
 * Discord/Slack. Constructs the same ChiefRunner the bot uses (claude /
 * sessions / events) but passes `source: "cli"` so Chief knows it's on the
 * terminal surface. Shares the messenger session-store keyed by
 * (orgSlug, userId) — the CLI uses a dedicated `cli-user` id by default so
 * its session doesn't collide with the messenger user's session.
 */
export interface ChatOpts {
  org?: string;
  user?: string;
}

const CLI_USER_ID = "cli-user";

function resolveChiefName(orgSlug: string, workspace: string): string {
  try {
    return loadOrgYaml(getOrgDir(orgSlug, workspace))?.chief_name?.trim() || "Chief";
  } catch {
    return "Chief";
  }
}

export async function chatCommand(
  message: string[] | undefined,
  opts: ChatOpts,
): Promise<void> {
  const workspaceRoot = getWorkspaceDir();
  const orgs = listOrganizations(workspaceRoot);
  if (orgs.length === 0) {
    console.log("No organizations found. Run `solosquad init` first.");
    return;
  }

  // Org selection: explicit --org, else auto-pick when there's exactly one.
  let org = opts.org
    ? orgs.find((o) => o.slug === opts.org)
    : orgs.length === 1
      ? orgs[0]
      : undefined;
  if (!org) {
    if (opts.org) {
      console.log(
        `Org "${opts.org}" not found. Available: ${orgs.map((o) => o.slug).join(", ")}`,
      );
    } else {
      console.log("Multiple orgs found — pick one with --org <slug>:");
      for (const o of orgs) console.log(`  - ${o.slug}`);
    }
    return;
  }

  const orgSlug = org.slug;
  const orgCwd = org.path;
  const userId = opts.user || CLI_USER_ID;
  const chiefName = resolveChiefName(orgSlug, workspaceRoot);

  const claude = new RealClaudeProcessFactory();
  const sessions = new SessionStore(workspaceRoot);
  const chiefRunner = new ChiefRunner({
    claude,
    sessions,
    events: (slug, uid) =>
      new FileEventSink(pmEventsPath(workspaceRoot, slug, uid)),
  });

  const ask = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      const reply = await chiefRunner.handleUserMessage({
        userId,
        orgSlug,
        orgCwd,
        userText: trimmed,
        source: "cli",
      });
      console.log(`\n${chiefName}: ${reply.text}\n`);
    } catch (e) {
      console.log(`\n[error] ${e instanceof Error ? e.message : e}\n`);
    }
  };

  // One-shot mode: `solosquad chat "your message"`.
  const oneShot = (message ?? []).join(" ").trim();
  if (oneShot) {
    await ask(oneShot);
    return;
  }

  // Interactive REPL.
  console.log(
    `Chatting with ${chiefName} (org: ${orgSlug}). Type "exit" or Ctrl+C to quit.\n`,
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.setPrompt("you> ");
  rl.prompt();
  rl.on("line", async (line) => {
    const input = line.trim();
    if (input === "exit" || input === "quit") {
      rl.close();
      return;
    }
    if (!input) {
      rl.prompt();
      return;
    }
    // Pause input while Chief thinks so the prompt doesn't interleave with
    // the streamed reply, then resume for the next turn.
    rl.pause();
    await ask(input);
    rl.resume();
    rl.prompt();
  });
  await new Promise<void>((resolve) => rl.on("close", () => resolve()));
}
