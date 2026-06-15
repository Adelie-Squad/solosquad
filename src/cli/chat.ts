import path from "path";
import * as readline from "readline";
import { RealClaudeProcessFactory } from "../bot/claude-process.js";
import { ChiefRunner } from "../bot/chief-runner.js";
import { SessionStore } from "../bot/session-store.js";
import { FileEventSink, chiefEventsPath } from "../bot/events.js";
import { getWorkspaceDir, getOrgDir } from "../util/paths.js";
import {
  listOrganizations,
  loadOrgYaml,
  setDevCapabilityEnabled,
} from "../util/config.js";

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
      new FileEventSink(chiefEventsPath(workspaceRoot, slug, uid)),
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
      // v1.2.9 §D — turn aborted via /cancel: the cancel handler already
      // printed the notice; don't echo the partial reply.
      if (reply.aborted) return;
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
  // v1.2.9 §D — non-blocking REPL: input stays live while Chief works so the
  // user can type `/cancel` mid-turn. `busy` gates ordinary input (one turn at
  // a time); only `/cancel` is honored while busy.
  let busy = false;
  rl.setPrompt("you> ");
  rl.prompt();
  rl.on("line", async (line) => {
    const input = line.trim();
    if (input === "/cancel") {
      const ok = chiefRunner.cancelTurn(orgSlug, userId);
      console.log(
        ok ? "🛑 진행 중인 작업을 취소했습니다." : "취소할 진행 중인 작업이 없습니다.",
      );
      if (!busy) rl.prompt();
      return;
    }
    // v1.2.9 §E — toggle dev mode (file write + git) from the terminal.
    if (input === "/grant" || input === "/revoke") {
      const enable = input === "/grant";
      try {
        const prev = setDevCapabilityEnabled(enable, workspaceRoot);
        console.log(
          enable
            ? prev
              ? "✅ dev 권한이 이미 켜져 있습니다."
              : "✅ dev 권한을 켰습니다 — 파일 쓰기·git(push 제외) 가능. 다시 요청해 주세요."
            : prev
              ? "🔒 dev 권한을 껐습니다 — read-only 로 전환."
              : "🔒 dev 권한이 이미 꺼져 있습니다.",
        );
      } catch (e) {
        console.log(`권한 변경 실패: ${e instanceof Error ? e.message : e}`);
      }
      if (!busy) rl.prompt();
      return;
    }
    if (busy) {
      console.log("작업 중입니다 — /cancel 로 취소할 수 있습니다.");
      return;
    }
    if (input === "exit" || input === "quit") {
      rl.close();
      return;
    }
    if (!input) {
      rl.prompt();
      return;
    }
    busy = true;
    await ask(input);
    busy = false;
    rl.prompt();
  });
  await new Promise<void>((resolve) => rl.on("close", () => resolve()));
}
