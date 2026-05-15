#!/usr/bin/env node
/**
 * v0.8.3 §8 — one-shot trajectory ROI measurement.
 *
 * Computes the 4 ROI indicators from v0.6 §3.X over the last 30 days of
 * workspace data. The output is meant to be pasted into the CHANGELOG
 * [0.8.3] entry to *박제* (lock in) the decision for v0.9 auto-register.
 *
 * Indicators:
 *   1. Trajectory suggestion count (>= 5 to pass)
 *   2. Adoption rate of suggestions (>= 60% to pass)
 *   3. Average usage uplift of adopted SKILLs in the following 30 days
 *      (>= average / not regressed)
 *   4. Reject cooldown trigger rate (< 30%)
 *
 * Usage:
 *   npx tsx scripts/measure-trajectory-roi.ts
 *   npx tsx scripts/measure-trajectory-roi.ts --workspace /path/to/ws
 *   npx tsx scripts/measure-trajectory-roi.ts --window-days 30
 *
 * The script is deliberately conservative when data is missing — it
 * prints "측정 시점에 채움" placeholders instead of fabricating numbers.
 */

import fs from "fs";
import path from "path";

interface CliArgs {
  workspace: string;
  windowDays: number;
  json: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let workspace = process.cwd();
  let windowDays = 30;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workspace" && i + 1 < argv.length) {
      workspace = path.resolve(argv[++i]);
    } else if (a === "--window-days" && i + 1 < argv.length) {
      windowDays = Math.max(1, parseInt(argv[++i], 10));
    } else if (a === "--json") {
      json = true;
    }
  }
  return { workspace, windowDays, json };
}

interface OrgPaths {
  slug: string;
  memoryDir: string;
}

function listOrgs(workspace: string): OrgPaths[] {
  const out: OrgPaths[] = [];
  if (!fs.existsSync(workspace)) return out;
  for (const entry of fs.readdirSync(workspace, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const orgYaml = path.join(workspace, entry.name, ".org.yaml");
    if (!fs.existsSync(orgYaml)) continue;
    const memoryDir = path.join(workspace, entry.name, "memory");
    out.push({ slug: entry.name, memoryDir });
  }
  return out;
}

interface JsonlEvent {
  ts?: string;
  event_type?: string;
  [k: string]: unknown;
}

function* readJsonl(file: string): IterableIterator<JsonlEvent> {
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf-8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as JsonlEvent;
    } catch {
      // skip malformed
    }
  }
}

interface Indicator {
  name: string;
  threshold: string;
  measured: string;
  passed: boolean | null; // null = insufficient data
}

function measureForOrg(org: OrgPaths, windowDays: number): Indicator[] {
  const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;

  // Candidate sources — we tolerate either trajectory-*.jsonl or generic
  // route-events.jsonl tagged with event_type "trajectory_suggestion" /
  // "trajectory_adoption" / "trajectory_reject_cooldown".
  const candidates = [
    "trajectory-events.jsonl",
    "trajectory.jsonl",
    "route-events.jsonl",
    "author-events.jsonl",
  ];

  let suggestions = 0;
  let adoptions = 0;
  let rejects = 0;
  const adoptedSkills = new Set<string>();
  const usageBefore = new Map<string, number>();
  const usageAfter = new Map<string, number>();

  for (const filename of candidates) {
    const file = path.join(org.memoryDir, filename);
    for (const ev of readJsonl(file)) {
      const ts = typeof ev.ts === "string" ? Date.parse(ev.ts) : NaN;
      const type = typeof ev.event_type === "string" ? ev.event_type : "";
      if (Number.isNaN(ts)) continue;
      if (ts < cutoffMs) continue;
      if (type === "trajectory_suggestion") suggestions++;
      else if (type === "trajectory_adoption") {
        adoptions++;
        const skill = typeof ev.skill === "string" ? ev.skill : "";
        if (skill) adoptedSkills.add(skill);
      } else if (type === "trajectory_reject_cooldown") rejects++;
      // Usage tally (route_hit on adopted SKILL — for indicator 3)
      else if (type === "route_hit") {
        const skill = typeof ev.skill === "string" ? ev.skill : "";
        if (skill) {
          const within15dCutoff = Date.now() - 15 * 24 * 60 * 60 * 1000;
          if (ts < within15dCutoff) {
            usageBefore.set(skill, (usageBefore.get(skill) ?? 0) + 1);
          } else {
            usageAfter.set(skill, (usageAfter.get(skill) ?? 0) + 1);
          }
        }
      }
    }
  }

  const adoptionRate = suggestions === 0 ? null : adoptions / suggestions;
  const rejectRate = suggestions === 0 ? null : rejects / suggestions;

  // Indicator 3 — usage uplift average for adopted skills (best-effort).
  let upliftAvg: number | null = null;
  if (adoptedSkills.size > 0) {
    let total = 0;
    let count = 0;
    for (const skill of adoptedSkills) {
      const before = usageBefore.get(skill) ?? 0;
      const after = usageAfter.get(skill) ?? 0;
      if (before + after === 0) continue;
      total += after - before;
      count++;
    }
    upliftAvg = count === 0 ? null : total / count;
  }

  return [
    {
      name: "30일 내 trajectory 제안",
      threshold: ">= 5",
      measured: suggestions === 0 ? "측정 시점에 채움 (데이터 없음)" : `${suggestions}건`,
      passed: suggestions === 0 ? null : suggestions >= 5,
    },
    {
      name: "제안 채택률",
      threshold: ">= 60%",
      measured: adoptionRate === null
        ? "측정 시점에 채움 (제안 없음)"
        : `${(adoptionRate * 100).toFixed(1)}% (${adoptions}/${suggestions})`,
      passed: adoptionRate === null ? null : adoptionRate >= 0.6,
    },
    {
      name: "채택 SKILL의 30일 사용률 uplift",
      threshold: ">= 평균",
      measured: upliftAvg === null
        ? "측정 시점에 채움 (채택 0건 또는 사용 이벤트 없음)"
        : `${upliftAvg.toFixed(2)} 회/SKILL 평균 변동`,
      passed: upliftAvg === null ? null : upliftAvg >= 0,
    },
    {
      name: "사용자 reject cooldown 패턴",
      threshold: "< 30%",
      measured: rejectRate === null
        ? "측정 시점에 채움 (제안 없음)"
        : `${(rejectRate * 100).toFixed(1)}% (${rejects}/${suggestions})`,
      passed: rejectRate === null ? null : rejectRate < 0.3,
    },
  ];
}

function renderReport(args: CliArgs, orgs: OrgPaths[]): string {
  const lines: string[] = [];
  lines.push(`# v0.8.3 trajectory ROI measurement`);
  lines.push(`workspace: ${args.workspace}`);
  lines.push(`window: ${args.windowDays} days`);
  lines.push(`orgs: ${orgs.length}`);
  lines.push("");
  if (orgs.length === 0) {
    lines.push("> 조직 데이터 없음 — 본 패치는 측정 스크립트만 commit, CHANGELOG에 placeholder 박제");
    return lines.join("\n");
  }
  for (const org of orgs) {
    lines.push(`## [${org.slug}]`);
    const ind = measureForOrg(org, args.windowDays);
    for (const i of ind) {
      const verdict = i.passed === null ? "—" : i.passed ? "PASS" : "FAIL";
      lines.push(`- ${i.name} (${i.threshold}): ${i.measured}  [${verdict}]`);
    }
    const decisive = ind.every((i) => i.passed === true);
    const insufficient = ind.some((i) => i.passed === null);
    lines.push("");
    if (insufficient) {
      lines.push(`> [${org.slug}] 결정 보류: 데이터 부족 — CHANGELOG에 "측정 시점에 채움" 표기.`);
    } else if (decisive) {
      lines.push(`> [${org.slug}] 4지표 모두 통과 → v0.9 auto_register 활성 후보.`);
    } else {
      lines.push(`> [${org.slug}] 1개 이상 실패 → "제안만 영구" 잠금 후보.`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const orgs = listOrgs(args.workspace);

  if (args.json) {
    const report = orgs.map((o) => ({
      org: o.slug,
      indicators: measureForOrg(o, args.windowDays),
    }));
    console.log(JSON.stringify({ workspace: args.workspace, windowDays: args.windowDays, orgs: report }, null, 2));
    return;
  }

  console.log(renderReport(args, orgs));
}

main();
