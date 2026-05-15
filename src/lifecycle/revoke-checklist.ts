import fs from "fs";
import path from "path";
import os from "os";
import { listOrganizations } from "../util/config.js";
import { getEnvPath } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.7 — REVOKE-CHECKLIST.md generator.
 * Per docs/plan/v0.7-uninstall-lifecycle.md §8 + §10 #7.
 *
 * Collects the workspace-specific bits needed to write a useful revoke
 * checklist: Discord/Slack/Anthropic identifiers (non-secret), encoded
 * Claude Code project paths, channel names, and process-check command
 * hints. The checklist is written twice — to the workspace root (so the
 * user sees it after uninstall) and inside the archive zip (so it travels
 * with the export).
 */

export interface RevokeChecklistData {
  workspace: string;
  workspaceSlug: string;
  generatedAt: string;
  /** From .env, non-secret. */
  discordApplicationId?: string;
  /** Best-effort prefix (sk-ant-api03-XXXX...) — non-secret. */
  anthropicKeyPrefix?: string;
  /** Slack channels SoloSquad created by convention. */
  slackChannelsByConvention: string[];
  /** Best-effort path candidates for ~/.claude/projects transcripts. */
  pmSessionTranscriptDirs: string[];
  orgSlugs: string[];
}

export function collectRevokeData(workspace: string, nowIso?: string): RevokeChecklistData {
  const orgSlugs = listOrganizations(workspace).map((o) => o.slug);

  const envPath = path.join(workspace, ".solosquad", ".env");
  const envExists = fs.existsSync(envPath) ? envPath : getEnvPath(workspace);
  const env = fs.existsSync(envExists)
    ? parseEnvLines(fs.readFileSync(envExists, "utf-8"))
    : new Map<string, string>();

  const discordToken = env.get("DISCORD_TOKEN") ?? "";
  const discordApplicationId =
    env.get("DISCORD_APPLICATION_ID") ?? extractDiscordAppIdFromToken(discordToken);

  const anthropicKey = env.get("ANTHROPIC_API_KEY") ?? "";
  const anthropicKeyPrefix = anthropicKey.length >= 14 ? anthropicKey.slice(0, 14) + "…" : undefined;

  const slackChannels: string[] = [];
  const cmdChan = env.get("SLACK_COMMAND_CHANNEL");
  if (cmdChan) slackChannels.push(`#${cmdChan.replace(/^#/, "")}`);
  slackChannels.push("#workflow"); // by SoloSquad convention

  const pmSessionTranscriptDirs = guessClaudeProjectDirs(workspace, orgSlugs);
  const workspaceSlug = path.basename(workspace);

  return {
    workspace,
    workspaceSlug,
    generatedAt: nowIso ?? new Date().toISOString(),
    discordApplicationId,
    anthropicKeyPrefix,
    slackChannelsByConvention: slackChannels,
    pmSessionTranscriptDirs,
    orgSlugs,
  };
}

export function renderRevokeChecklist(data: RevokeChecklistData): string {
  const lines: string[] = [];
  lines.push(`# Revoke Checklist — generated ${data.generatedAt}`);
  lines.push("");
  lines.push("> SoloSquad를 제거하기 전/후, 다음 외부 자원을 직접 정리하세요.");
  lines.push("> 로컬 파일 정리만으로는 보안이 완결되지 않습니다.");
  lines.push("");
  lines.push("## 1. Anthropic API Key (필수)");
  lines.push("");
  lines.push("- 콘솔: https://console.anthropic.com/settings/keys");
  if (data.anthropicKeyPrefix) {
    lines.push(`- 이 워크스페이스에서 사용된 키 식별 힌트:`);
    lines.push(`  - key prefix: ${data.anthropicKeyPrefix}`);
  } else {
    lines.push(`- 이 워크스페이스의 .env에 ANTHROPIC_API_KEY가 없거나 비어 있어 prefix 식별 불가`);
  }
  lines.push(`- 작업: 해당 키를 "Revoke" 또는 "Disable"`);
  lines.push(`- 확인: 콘솔의 Usage에서 새 사용량이 0인지 24h 후 재확인`);
  lines.push("");

  lines.push("## 2. Discord Bot Application (있는 경우)");
  lines.push("");
  lines.push("- 콘솔: https://discord.com/developers/applications");
  if (data.discordApplicationId) {
    lines.push(`- 봇 application ID: ${data.discordApplicationId}`);
    lines.push("  (위 ID는 .env에서 추출 — 시크릿 아님)");
  } else {
    lines.push("- 봇 application ID: .env에서 식별 불가 (DISCORD_APPLICATION_ID 또는 DISCORD_TOKEN 부재)");
  }
  lines.push("- 작업:");
  lines.push('  1. 봇 application 열기 → "Delete App" (영구) 또는');
  lines.push('  2. Bot 탭에서 "Reset Token" (토큰만 무효화, app은 유지)');
  lines.push("- 봇이 가입한 서버에서: 서버 설정 → Integrations → 봇 제거");
  lines.push("");

  lines.push("## 3. Slack App (있는 경우)");
  lines.push("");
  lines.push("- 콘솔: https://api.slack.com/apps");
  if (data.slackChannelsByConvention.length > 0) {
    lines.push("- 봇이 만든 채널(관례):");
    for (const ch of data.slackChannelsByConvention) lines.push(`  - ${ch}`);
  }
  lines.push("- 작업:");
  lines.push("  1. 봇 app을 워크스페이스에서 Uninstall");
  lines.push("  2. 위 채널은 자동 삭제되지 않음 — 수동으로 Archive 권장");
  lines.push("  3. (선택) app 자체 Delete");
  lines.push("");

  lines.push("## 4. ~/.claude/projects/ (Claude Code 영역)");
  lines.push("");
  if (data.pmSessionTranscriptDirs.length > 0) {
    lines.push("- SoloSquad PM session transcript 추정 위치:");
    for (const p of data.pmSessionTranscriptDirs) lines.push(`  - ${p}`);
  } else {
    lines.push("- transcript 추정 경로 없음 — `~/.claude/projects/` 직접 확인");
  }
  lines.push("- Claude Code를 계속 사용한다면 이 파일은 그대로 둬도 됨");
  lines.push("- 완전 삭제: 위 디렉토리를 명시적으로 rm -rf (rm 전 ls로 확인)");
  lines.push("");

  lines.push("## 5. 백그라운드 프로세스 (있는 경우)");
  lines.push("");
  lines.push("- 다음이 등록돼 있는지 확인:");
  lines.push("  - pm2 list  → solosquad-bot, solosquad-scheduler");
  lines.push("  - systemctl --user list-units → solosquad-*");
  lines.push("  - Windows 작업 스케줄러 → SoloSquad 관련 항목");
  lines.push("- 모두 stop + disable");
  lines.push("");

  lines.push("## 6. cron / 스케줄러");
  lines.push("");
  lines.push("- crontab -l 에 `solosquad`가 나타나는지 확인");
  lines.push("- 있다면 해당 줄 제거: crontab -e");
  lines.push("");

  lines.push("## 7. MCP 서버 credential (있는 경우)");
  lines.push("");
  lines.push("- ~/.config/mcp/<server>/credentials.json 등 SoloSquad 외부의 MCP 자격증명");
  lines.push("- SoloSquad는 이 파일을 보지 않음 — 사용자 도구 영역");
  lines.push("");

  return lines.join("\n");
}

/**
 * Stand-alone references for the archive's `manual-revoke-required/` folder.
 * Each section becomes a separate markdown so the archive is self-contained
 * even if REVOKE-CHECKLIST.md is misplaced.
 */
export function renderManualRevokeFiles(data: RevokeChecklistData): Map<string, string> {
  const files = new Map<string, string>();
  files.set("manual-revoke-required/anthropic.md", renderSection(data, "anthropic"));
  files.set("manual-revoke-required/discord.md", renderSection(data, "discord"));
  files.set("manual-revoke-required/slack.md", renderSection(data, "slack"));
  files.set("manual-revoke-required/claude-projects.md", renderSection(data, "claude"));
  files.set("manual-revoke-required/processes.md", renderSection(data, "processes"));
  files.set("manual-revoke-required/mcp.md", renderSection(data, "mcp"));
  return files;
}

function renderSection(
  data: RevokeChecklistData,
  section: "anthropic" | "discord" | "slack" | "claude" | "processes" | "mcp",
): string {
  const full = renderRevokeChecklist(data).split("\n");
  const headers: Record<typeof section, string> = {
    anthropic: "## 1. Anthropic API Key (필수)",
    discord: "## 2. Discord Bot Application (있는 경우)",
    slack: "## 3. Slack App (있는 경우)",
    claude: "## 4. ~/.claude/projects/ (Claude Code 영역)",
    processes: "## 5. 백그라운드 프로세스 (있는 경우)",
    mcp: "## 7. MCP 서버 credential (있는 경우)",
  };
  const start = full.findIndex((l) => l === headers[section]);
  if (start < 0) return `# Section ${section}\n\nNot found in main checklist.`;
  const end = full.findIndex((l, i) => i > start && /^## /.test(l));
  const body = end < 0 ? full.slice(start) : full.slice(start, end);
  return body.join("\n") + "\n";
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function parseEnvLines(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of normalizeLine(text).split("\n")) {
    const t = line.trim();
    if (t.length === 0 || t.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    map.set(key, value);
  }
  return map;
}

/**
 * Discord bot tokens are structured as `<application_id_base64>.<rand>.<sig>`.
 * The first segment decodes to the application ID. We surface a best-effort
 * extraction so the checklist can show a clickable identifier.
 */
function extractDiscordAppIdFromToken(token: string): string | undefined {
  if (!token || token === "your-discord-bot-token-here") return undefined;
  const head = token.split(".")[0];
  if (!head) return undefined;
  try {
    const padded = head + "=".repeat((4 - (head.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf-8");
    if (/^\d{17,20}$/.test(decoded)) return decoded;
  } catch {
    // ignore
  }
  return undefined;
}

function guessClaudeProjectDirs(workspace: string, orgSlugs: string[]): string[] {
  const home = os.homedir();
  const root = path.join(home, ".claude", "projects");
  // Claude Code encodes the working directory by replacing path separators
  // with hyphens. SoloSquad PM sessions run from `<workspace>/<org>/`.
  const candidates: string[] = [];
  for (const org of orgSlugs) {
    const cwd = path.join(workspace, org);
    const encoded = cwd.replace(/[\\/:]/g, "-");
    candidates.push(path.join(root, encoded));
  }
  // Also include workspace-rooted PM session candidate.
  const wsEncoded = workspace.replace(/[\\/:]/g, "-");
  candidates.push(path.join(root, wsEncoded));
  return Array.from(new Set(candidates));
}

/** Mostly for tests. */
export const _revokeInternals = {
  parseEnvLines,
  extractDiscordAppIdFromToken,
  guessClaudeProjectDirs,
};
