import fs from "fs";
import path from "path";
import os from "os";
import chalk from "chalk";
import yaml from "js-yaml";
import { getWorkspaceRoot } from "../util/paths.js";
import { normalizeLine } from "../util/platform.js";
import { LEDGER_REL_PATH, loadLedger } from "../analyze/ledger.js";

/**
 * v0.6 P1 #7 — Readiness check for S1 회고 작업.
 *
 * `solosquad readiness check --target v0.6` 는 워크스페이스를 스캔해
 * v0.5 운영 데이터(author-costs.jsonl 행 수, 4종 워크플로 실행 카운트,
 * SKILL 카운트, analysis-ledger 행 수)가 *회고 작업에 의미가 있을 만큼*
 * 누적됐는지 결정적으로 판단한다.
 *
 * Pass criteria (v0.6 §6 / docs/plan/v0.6-default-workflow-tuning.md):
 *   - 4종 템플릿(PMF / Feature / Rebranding / Prototype) 중 ≥ 1종 실행
 *   - author 루프 산출(author-costs.jsonl) ≥ 10 행
 *
 * Exit code: 0 = 통과, 1 = 데이터 부족.
 */

export interface ReadinessOpts {
  target?: string;
  workspace?: string;
}

export interface ReadinessReport {
  workspace: string;
  authorCostRows: number;
  workflowsByTemplate: Record<TemplateKey, number>;
  authorSkillCount: number;
  ledgerEntries: number;
  pass: boolean;
  reason: string;
  recentActiveDays: number;
}

const TEMPLATE_KEYS = ["pmf", "feature", "rebranding", "prototype"] as const;
type TemplateKey = (typeof TEMPLATE_KEYS)[number];

const MIN_AUTHOR_COSTS = 10;
const MIN_TEMPLATES_COVERED = 1; // ≥ 1종 워크플로
const RECENT_WINDOW_DAYS = 14;

export async function readinessCheckCommand(opts: ReadinessOpts): Promise<void> {
  const target = opts.target ?? "v0.6";
  const workspace = opts.workspace ?? getWorkspaceRoot();

  console.log(chalk.bold(`\nSoloSquad — Readiness Check (target ${target})\n`));
  console.log(chalk.dim(`Workspace: ${workspace}\n`));

  if (target !== "v0.6") {
    console.log(chalk.yellow(`  지원하지 않는 target: ${target}`));
    console.log(chalk.dim("  현재 지원: v0.6"));
    process.exit(1);
  }

  const report = scanWorkspace(workspace);
  printReport(report);

  process.exit(report.pass ? 0 : 1);
}

export function scanWorkspace(workspace: string): ReadinessReport {
  const authorCostRows = countAuthorCostRows(workspace);
  const recentActiveDays = countRecentActiveDays(workspace, RECENT_WINDOW_DAYS);
  const workflowsByTemplate = countWorkflowsByTemplate(workspace);
  const authorSkillCount = countAuthorSkills(workspace);
  const ledgerEntries = countLedgerEntries(workspace);

  const templatesCovered = TEMPLATE_KEYS.filter(
    (k) => workflowsByTemplate[k] > 0
  ).length;

  const { pass, reason } = evaluate({
    authorCostRows,
    templatesCovered,
  });

  return {
    workspace,
    authorCostRows,
    workflowsByTemplate,
    authorSkillCount,
    ledgerEntries,
    pass,
    reason,
    recentActiveDays,
  };
}

function evaluate(input: {
  authorCostRows: number;
  templatesCovered: number;
}): { pass: boolean; reason: string } {
  if (input.templatesCovered < MIN_TEMPLATES_COVERED) {
    return {
      pass: false,
      reason: `4종 워크플로 중 ${input.templatesCovered}종만 실행 (최소 ${MIN_TEMPLATES_COVERED}종 필요)`,
    };
  }
  if (input.authorCostRows < MIN_AUTHOR_COSTS) {
    return {
      pass: false,
      reason: `author 산출 ${input.authorCostRows}건 (최소 ${MIN_AUTHOR_COSTS}건 필요)`,
    };
  }
  return { pass: true, reason: "임계 충족" };
}

function printReport(r: ReadinessReport): void {
  console.log(chalk.dim("v0.5 author 데이터:"));
  console.log(
    `  author-costs.jsonl 행 수: ${chalk.bold(r.authorCostRows)} (최소 ${MIN_AUTHOR_COSTS})`
  );
  console.log(
    `  최근 ${RECENT_WINDOW_DAYS}일 활성일: ${chalk.bold(r.recentActiveDays)}일`
  );

  console.log(chalk.dim("\n4종 워크플로 실행 카운트:"));
  let covered = 0;
  for (const k of TEMPLATE_KEYS) {
    const n = r.workflowsByTemplate[k];
    if (n > 0) covered++;
    const mark = n > 0 ? chalk.green("✓") : chalk.dim("·");
    console.log(`  ${mark} ${k.padEnd(12)} ${n}회`);
  }
  console.log(chalk.dim(`  → ${covered}/4 템플릿 커버`));

  console.log(chalk.dim("\nSKILL / 분석 자산:"));
  console.log(`  author SKILL.md: ${chalk.bold(r.authorSkillCount)} 건`);
  console.log(`  analysis-ledger 엔트리: ${chalk.bold(r.ledgerEntries)} 건`);

  console.log();
  if (r.pass) {
    console.log(chalk.green.bold("✓ S1 시작 가능"));
    console.log(chalk.dim(`  사유: ${r.reason}`));
  } else {
    console.log(chalk.yellow.bold("⚠ 데이터 부족 — 추가 운영 후 재실행 권고"));
    console.log(chalk.dim(`  사유: ${r.reason}`));
    console.log(
      chalk.dim(
        `  v0.6 §6: 임계 미달 시 회고 작업은 가설로만 진행. 4~6주 추가 누적 후 재실행.`
      )
    );
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

function listOrgDirs(workspace: string): string[] {
  if (!fs.existsSync(workspace)) return [];
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workspace, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    // org dir must have .org.yaml
    const orgYaml = path.join(workspace, e.name, ".org.yaml");
    if (fs.existsSync(orgYaml)) out.push(path.join(workspace, e.name));
  }
  return out;
}

function countAuthorCostRows(workspace: string): number {
  let total = 0;
  for (const orgDir of listOrgDirs(workspace)) {
    const file = path.join(orgDir, "memory", "author-costs.jsonl");
    if (!fs.existsSync(file)) continue;
    try {
      const raw = normalizeLine(fs.readFileSync(file, "utf-8"));
      for (const line of raw.split("\n")) {
        if (line.trim()) total++;
      }
    } catch {
      // skip
    }
  }
  return total;
}

function countRecentActiveDays(workspace: string, windowDays: number): number {
  const now = Date.now();
  const cutoff = now - windowDays * 24 * 60 * 60 * 1000;
  const days = new Set<string>();
  for (const orgDir of listOrgDirs(workspace)) {
    const file = path.join(orgDir, "memory", "author-costs.jsonl");
    if (!fs.existsSync(file)) continue;
    try {
      const raw = normalizeLine(fs.readFileSync(file, "utf-8"));
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as { ts?: string };
          if (typeof parsed.ts !== "string") continue;
          const t = Date.parse(parsed.ts);
          if (Number.isNaN(t) || t < cutoff) continue;
          days.add(parsed.ts.slice(0, 10));
        } catch {
          // skip corrupt line
        }
      }
    } catch {
      // skip
    }
  }
  return days.size;
}

function countWorkflowsByTemplate(
  workspace: string
): Record<TemplateKey, number> {
  const result: Record<TemplateKey, number> = {
    pmf: 0,
    feature: 0,
    rebranding: 0,
    prototype: 0,
  };
  for (const orgDir of listOrgDirs(workspace)) {
    const workflowsDir = path.join(orgDir, "workflows");
    if (!fs.existsSync(workflowsDir)) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(workflowsDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const wf of entries) {
      if (!wf.isDirectory()) continue;
      const key = classifyWorkflow(path.join(workflowsDir, wf.name));
      if (key) result[key]++;
    }
  }
  return result;
}

function classifyWorkflow(wfDir: string): TemplateKey | null {
  // 1. _status.yaml has project.type
  const statusPath = path.join(wfDir, "_status.yaml");
  if (fs.existsSync(statusPath)) {
    try {
      const doc = yaml.load(
        normalizeLine(fs.readFileSync(statusPath, "utf-8"))
      ) as { project?: { type?: string } } | undefined;
      const rawType = doc?.project?.type?.toLowerCase() ?? "";
      const fromStatus = normalizeTemplateKey(rawType);
      if (fromStatus) return fromStatus;
    } catch {
      // fall through
    }
  }
  // 2. PRD.md heuristic — first 200 chars
  const prdPath = path.join(wfDir, "PRD.md");
  if (fs.existsSync(prdPath)) {
    try {
      const head = normalizeLine(fs.readFileSync(prdPath, "utf-8")).slice(
        0,
        400
      );
      const lower = head.toLowerCase();
      if (lower.includes("pmf") || head.includes("PMF")) return "pmf";
      if (lower.includes("feature") || head.includes("기능")) return "feature";
      if (lower.includes("rebrand") || head.includes("리브랜")) return "rebranding";
      if (lower.includes("prototype") || head.includes("프로토타입")) return "prototype";
    } catch {
      // skip
    }
  }
  return null;
}

function normalizeTemplateKey(raw: string): TemplateKey | null {
  if (!raw) return null;
  if (raw.includes("pmf")) return "pmf";
  if (raw.includes("feature") || raw.includes("기능")) return "feature";
  if (raw.includes("rebrand")) return "rebranding";
  if (raw.includes("prototype") || raw.includes("experiment")) return "prototype";
  return null;
}

function countAuthorSkills(workspace: string): number {
  let total = 0;
  // <org>/.agents/{team}/{slug}/SKILL.md
  for (const orgDir of listOrgDirs(workspace)) {
    total += countSkillsTree(path.join(orgDir, ".agents"));
  }
  // ~/.solosquad/agents/{team}/{slug}/SKILL.md (user global)
  total += countSkillsTree(path.join(os.homedir(), ".solosquad", "agents"));
  return total;
}

function countSkillsTree(root: string): number {
  if (!fs.existsSync(root)) return 0;
  let total = 0;
  let teams: fs.Dirent[];
  try {
    teams = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const team of teams) {
    if (!team.isDirectory()) continue;
    if (team.name.startsWith("_") || team.name.startsWith(".")) continue;
    const teamDir = path.join(root, team.name);
    let agents: fs.Dirent[];
    try {
      agents = fs.readdirSync(teamDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const agent of agents) {
      if (!agent.isDirectory()) continue;
      const skill = path.join(teamDir, agent.name, "SKILL.md");
      if (fs.existsSync(skill)) total++;
    }
  }
  return total;
}

function countLedgerEntries(workspace: string): number {
  let total = 0;
  for (const orgDir of listOrgDirs(workspace)) {
    const ledgerPath = path.join(orgDir, LEDGER_REL_PATH);
    if (!fs.existsSync(ledgerPath)) continue;
    const ledger = loadLedger(ledgerPath);
    if (ledger) total += ledger.analyzed.length;
  }
  return total;
}
