import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getOrgDir } from "../util/paths.js";
import { normalizeLine, parseTsv } from "../util/platform.js";
import { LEDGER_REL_PATH, loadLedger } from "../analyze/ledger.js";

/**
 * v0.6 §2.5 — Retrospective stats ETL (회고 입력원 집계).
 *
 * Deterministic aggregation of v0.5 operational data into a markdown
 * report. Called by the `v06-retrospective-stats` routine (weekly cron).
 * Output: `<org>/memory/v0.6-retrospective-stats-<YYYY-MM-DD>.md`.
 *
 * No LLM calls — facts only. Retrospective text body is written by humans
 * who read this report.
 *
 * Coverage of §2 표 회고 작업 inputs:
 *   #1 누락/잉여 stage          — workflows _status.yaml stage status 분포
 *   #2 핸드오프 슬라이스 패턴   — _handoff.md 섹션 분포 (per agent)
 *   #3 Stage별 keep/discard    — goals results.tsv per-stage 비율
 *   #4 author SKILL 패턴       — author-costs.jsonl per-skill, per-step
 *   #5 / #6                    — 빈 섹션 (사람이 회고 후 채움)
 */

export interface StatsExtractInput {
  workspace: string;
  orgSlug: string;
  /** Override "today" — testing only. Format YYYY-MM-DD. */
  todayIso?: string;
}

export interface StatsExtractResult {
  outputPath: string;
  markdown: string;
  summary: {
    workflowsScanned: number;
    handoffsScanned: number;
    resultsRows: number;
    authorCostRows: number;
    ledgerEntries: number;
  };
}

export function extractV06Stats(input: StatsExtractInput): StatsExtractResult {
  const orgDir = getOrgDir(input.orgSlug, input.workspace);
  const today = (input.todayIso ?? new Date().toISOString().slice(0, 10)).trim();

  const workflowStats = collectWorkflowStageStats(orgDir);
  const handoffStats = collectHandoffPatterns(orgDir);
  const resultsStats = collectResultsStageStats(orgDir);
  const authorStats = collectAuthorPatterns(orgDir);
  const ledgerStats = collectLedgerStats(orgDir);

  const markdown = renderMarkdown({
    orgSlug: input.orgSlug,
    today,
    workflowStats,
    handoffStats,
    resultsStats,
    authorStats,
    ledgerStats,
  });

  const outputPath = path.join(
    orgDir,
    "memory",
    `v0.6-retrospective-stats-${today}.md`
  );
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, markdown, "utf-8");

  return {
    outputPath,
    markdown,
    summary: {
      workflowsScanned: workflowStats.totalWorkflows,
      handoffsScanned: handoffStats.totalHandoffs,
      resultsRows: resultsStats.totalRows,
      authorCostRows: authorStats.totalRows,
      ledgerEntries: ledgerStats.totalEntries,
    },
  };
}

// ---------------------------------------------------------------------------
// #1 — workflow stage status distribution (회고 누락/잉여 stage)
// ---------------------------------------------------------------------------

interface WorkflowStageStats {
  totalWorkflows: number;
  perStage: Record<
    string,
    { pending: number; in_progress: number; completed: number; other: number }
  >;
}

function collectWorkflowStageStats(orgDir: string): WorkflowStageStats {
  const result: WorkflowStageStats = { totalWorkflows: 0, perStage: {} };
  const workflowsDir = path.join(orgDir, "workflows");
  if (!fs.existsSync(workflowsDir)) return result;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workflowsDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const wf of entries) {
    if (!wf.isDirectory()) continue;
    const statusFile = path.join(workflowsDir, wf.name, "_status.yaml");
    if (!fs.existsSync(statusFile)) continue;
    result.totalWorkflows++;
    try {
      const doc = yaml.load(
        normalizeLine(fs.readFileSync(statusFile, "utf-8"))
      ) as { workflow?: Array<{ stage?: string; status?: string }> } | undefined;
      const stages = Array.isArray(doc?.workflow) ? doc!.workflow! : [];
      for (const stage of stages) {
        const name = stage.stage ?? "(unknown)";
        const status = stage.status ?? "pending";
        const bucket = result.perStage[name] ?? {
          pending: 0,
          in_progress: 0,
          completed: 0,
          other: 0,
        };
        if (status === "pending") bucket.pending++;
        else if (status === "in_progress") bucket.in_progress++;
        else if (status === "completed") bucket.completed++;
        else bucket.other++;
        result.perStage[name] = bucket;
      }
    } catch {
      // skip malformed status.yaml
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// #2 — handoff section distribution per agent (슬라이스 패턴)
// ---------------------------------------------------------------------------

interface HandoffStats {
  totalHandoffs: number;
  perAgent: Record<string, { count: number; avgSections: number }>;
  sectionFrequency: Record<string, number>;
}

const KNOWN_SECTIONS = [
  "Summary",
  "Artifacts",
  "Key Decisions",
  "Context for Next Agent",
  "Open Questions",
];

function collectHandoffPatterns(orgDir: string): HandoffStats {
  const result: HandoffStats = {
    totalHandoffs: 0,
    perAgent: {},
    sectionFrequency: {},
  };
  const workflowsDir = path.join(orgDir, "workflows");
  if (!fs.existsSync(workflowsDir)) return result;

  let workflows: fs.Dirent[];
  try {
    workflows = fs.readdirSync(workflowsDir, { withFileTypes: true });
  } catch {
    return result;
  }

  const perAgentRaw: Record<string, { count: number; sectionTotal: number }> = {};

  for (const wf of workflows) {
    if (!wf.isDirectory()) continue;
    const wfDir = path.join(workflowsDir, wf.name);
    let stageDirs: fs.Dirent[];
    try {
      stageDirs = fs.readdirSync(wfDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const stage of stageDirs) {
      if (!stage.isDirectory()) continue;
      const handoffPath = path.join(wfDir, stage.name, "_handoff.md");
      if (!fs.existsSync(handoffPath)) continue;
      result.totalHandoffs++;
      let raw: string;
      try {
        raw = normalizeLine(fs.readFileSync(handoffPath, "utf-8"));
      } catch {
        continue;
      }
      const sections = extractMarkdownHeadings(raw);
      const agentKey = stage.name; // stage dir is typically `stage-N-<agent>`
      const bucket = perAgentRaw[agentKey] ?? { count: 0, sectionTotal: 0 };
      bucket.count++;
      bucket.sectionTotal += sections.length;
      perAgentRaw[agentKey] = bucket;

      for (const h of sections) {
        result.sectionFrequency[h] = (result.sectionFrequency[h] ?? 0) + 1;
      }
    }
  }

  for (const [agent, raw] of Object.entries(perAgentRaw)) {
    result.perAgent[agent] = {
      count: raw.count,
      avgSections: raw.count > 0 ? raw.sectionTotal / raw.count : 0,
    };
  }
  return result;
}

function extractMarkdownHeadings(raw: string): string[] {
  const headings: string[] = [];
  for (const line of raw.split("\n")) {
    const match = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (match) headings.push(match[1].trim());
  }
  return headings;
}

// ---------------------------------------------------------------------------
// #3 — results.tsv per-stage keep/discard distribution
// ---------------------------------------------------------------------------

interface ResultsStageStats {
  totalRows: number;
  perAgent: Record<string, { keep: number; discard: number }>;
}

function collectResultsStageStats(orgDir: string): ResultsStageStats {
  const result: ResultsStageStats = { totalRows: 0, perAgent: {} };
  const goalsDir = path.join(orgDir, "goals");
  if (!fs.existsSync(goalsDir)) return result;

  let goals: fs.Dirent[];
  try {
    goals = fs.readdirSync(goalsDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const goal of goals) {
    if (!goal.isDirectory()) continue;
    const tsvPath = path.join(goalsDir, goal.name, "results.tsv");
    if (!fs.existsSync(tsvPath)) continue;
    let raw: string;
    try {
      raw = normalizeLine(fs.readFileSync(tsvPath, "utf-8"));
    } catch {
      continue;
    }
    // strip comment lines (start with `#`) before parsing TSV
    const stripped = raw
      .split("\n")
      .filter((l) => !l.startsWith("#"))
      .join("\n");
    const rows = parseTsv(stripped);
    for (const row of rows) {
      result.totalRows++;
      const agent = row.agent || "(unknown)";
      const status = (row.status || "").toLowerCase();
      const bucket = result.perAgent[agent] ?? { keep: 0, discard: 0 };
      if (status === "keep") bucket.keep++;
      else if (status === "discard") bucket.discard++;
      result.perAgent[agent] = bucket;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// #4 — author-costs.jsonl per-skill / per-step distribution
// ---------------------------------------------------------------------------

interface AuthorStats {
  totalRows: number;
  perSkill: Record<string, number>;
  perStep: Record<string, { count: number; totalUsd: number }>;
}

function collectAuthorPatterns(orgDir: string): AuthorStats {
  const result: AuthorStats = {
    totalRows: 0,
    perSkill: {},
    perStep: {},
  };
  const file = path.join(orgDir, "memory", "author-costs.jsonl");
  if (!fs.existsSync(file)) return result;
  let raw: string;
  try {
    raw = normalizeLine(fs.readFileSync(file, "utf-8"));
  } catch {
    return result;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as {
        skill_draft_id?: string;
        step?: string;
        usd?: number;
      };
      result.totalRows++;
      const skill = parsed.skill_draft_id ?? "(unknown)";
      result.perSkill[skill] = (result.perSkill[skill] ?? 0) + 1;
      const step = parsed.step ?? "(unknown)";
      const bucket = result.perStep[step] ?? { count: 0, totalUsd: 0 };
      bucket.count++;
      if (typeof parsed.usd === "number") bucket.totalUsd += parsed.usd;
      result.perStep[step] = bucket;
    } catch {
      // skip corrupt line
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ledger summary (회고 #1 보조 — 4-label 분포)
// ---------------------------------------------------------------------------

interface LedgerStats {
  totalEntries: number;
  perLabel: Record<string, number>;
  ambiguous: number;
}

function collectLedgerStats(orgDir: string): LedgerStats {
  const result: LedgerStats = {
    totalEntries: 0,
    perLabel: {},
    ambiguous: 0,
  };
  const ledgerPath = path.join(orgDir, LEDGER_REL_PATH);
  if (!fs.existsSync(ledgerPath)) return result;
  const ledger = loadLedger(ledgerPath);
  if (!ledger) return result;
  for (const entry of ledger.analyzed) {
    result.totalEntries++;
    const label = entry.classification;
    result.perLabel[label] = (result.perLabel[label] ?? 0) + 1;
    if (entry.ambiguous) result.ambiguous++;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

interface RenderInput {
  orgSlug: string;
  today: string;
  workflowStats: WorkflowStageStats;
  handoffStats: HandoffStats;
  resultsStats: ResultsStageStats;
  authorStats: AuthorStats;
  ledgerStats: LedgerStats;
}

function renderMarkdown(r: RenderInput): string {
  const lines: string[] = [];
  lines.push(`# v0.6 Retrospective Stats — ${r.orgSlug} (${r.today})`);
  lines.push("");
  lines.push(
    "> Deterministic ETL. No LLM. Use as raw material when authoring v0.6 §2 회고 본문."
  );
  lines.push("");

  // #1
  lines.push("## 회고 #1 — 누락/잉여 stage 분포");
  lines.push("");
  lines.push(`- Total workflows scanned: ${r.workflowStats.totalWorkflows}`);
  if (r.workflowStats.totalWorkflows > 0) {
    lines.push("");
    lines.push("| Stage | pending | in_progress | completed | other |");
    lines.push("|---|---:|---:|---:|---:|");
    const stageKeys = Object.keys(r.workflowStats.perStage).sort();
    for (const k of stageKeys) {
      const b = r.workflowStats.perStage[k];
      lines.push(
        `| ${k} | ${b.pending} | ${b.in_progress} | ${b.completed} | ${b.other} |`
      );
    }
  }
  lines.push("");

  // #1 보조 — ledger
  lines.push("### Ledger 4-label 분포 (회고 #1 보조)");
  lines.push("");
  lines.push(`- Total ledger entries: ${r.ledgerStats.totalEntries}`);
  lines.push(`- Ambiguous entries: ${r.ledgerStats.ambiguous}`);
  if (r.ledgerStats.totalEntries > 0) {
    lines.push("");
    lines.push("| Label | Count |");
    lines.push("|---|---:|");
    for (const [label, count] of Object.entries(r.ledgerStats.perLabel).sort()) {
      lines.push(`| ${label} | ${count} |`);
    }
  }
  lines.push("");

  // #2
  lines.push("## 회고 #2 — 핸드오프 슬라이스 패턴");
  lines.push("");
  lines.push(`- Total \`_handoff.md\` scanned: ${r.handoffStats.totalHandoffs}`);
  if (r.handoffStats.totalHandoffs > 0) {
    lines.push("");
    lines.push("### Per agent (stage dir name)");
    lines.push("");
    lines.push("| Agent | Count | Avg Sections |");
    lines.push("|---|---:|---:|");
    const agentKeys = Object.keys(r.handoffStats.perAgent).sort();
    for (const k of agentKeys) {
      const b = r.handoffStats.perAgent[k];
      lines.push(`| ${k} | ${b.count} | ${b.avgSections.toFixed(1)} |`);
    }
    lines.push("");
    lines.push("### Section frequency");
    lines.push("");
    lines.push("| Heading | Count | Standard? |");
    lines.push("|---|---:|---|");
    const sectionKeys = Object.keys(r.handoffStats.sectionFrequency).sort(
      (a, b) =>
        r.handoffStats.sectionFrequency[b] - r.handoffStats.sectionFrequency[a]
    );
    for (const k of sectionKeys) {
      const standard = KNOWN_SECTIONS.includes(k) ? "✓" : "·";
      lines.push(`| ${k} | ${r.handoffStats.sectionFrequency[k]} | ${standard} |`);
    }
  }
  lines.push("");

  // #3
  lines.push("## 회고 #3 — Stage별 keep/discard 비율");
  lines.push("");
  lines.push(`- Total \`results.tsv\` rows: ${r.resultsStats.totalRows}`);
  if (r.resultsStats.totalRows > 0) {
    lines.push("");
    lines.push("| Agent | Keep | Discard | Keep rate |");
    lines.push("|---|---:|---:|---:|");
    const keys = Object.keys(r.resultsStats.perAgent).sort();
    for (const k of keys) {
      const b = r.resultsStats.perAgent[k];
      const total = b.keep + b.discard;
      const rate = total > 0 ? ((b.keep / total) * 100).toFixed(1) + "%" : "—";
      lines.push(`| ${k} | ${b.keep} | ${b.discard} | ${rate} |`);
    }
  }
  lines.push("");

  // #4
  lines.push("## 회고 #4 — author SKILL 패턴");
  lines.push("");
  lines.push(`- Total author-cost rows: ${r.authorStats.totalRows}`);
  if (r.authorStats.totalRows > 0) {
    lines.push("");
    lines.push("### Top SKILLs by author cycles");
    lines.push("");
    lines.push("| SKILL draft id | Author cycles |");
    lines.push("|---|---:|");
    const skillEntries = Object.entries(r.authorStats.perSkill).sort(
      (a, b) => b[1] - a[1]
    );
    for (const [k, v] of skillEntries.slice(0, 20)) {
      lines.push(`| ${k} | ${v} |`);
    }
    lines.push("");
    lines.push("### Per step (count + total USD)");
    lines.push("");
    lines.push("| Step | Count | Total USD |");
    lines.push("|---|---:|---:|");
    const stepKeys = Object.keys(r.authorStats.perStep).sort();
    for (const k of stepKeys) {
      const b = r.authorStats.perStep[k];
      lines.push(`| ${k} | ${b.count} | ${b.totalUsd.toFixed(4)} |`);
    }
  }
  lines.push("");

  // #5 / #6 placeholders
  lines.push("## 회고 #5 — (사람이 채움)");
  lines.push("");
  lines.push("_빈 섹션 — 회고 결과 보고 갱신._");
  lines.push("");
  lines.push("## 회고 #6 — (사람이 채움)");
  lines.push("");
  lines.push("_빈 섹션 — 회고 결과 보고 갱신._");
  lines.push("");

  return lines.join("\n");
}
