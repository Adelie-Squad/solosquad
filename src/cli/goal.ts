import chalk from "chalk";
import fs from "fs";
import path from "path";
import inquirer from "inquirer";
import { getAssetsDir, getOrgDir, getWorkspaceRoot } from "../util/paths.js";
import { listOrganizations } from "../util/config.js";
import { parseGoalFile, GoalParseError, type GoalSpec } from "../engine/goal-parser.js";
import { loadAgentsMd } from "../engine/agents-md-loader.js";
import { readBest, readResults, resultsTsvPath, summarizeRun, goalDir } from "../engine/tracker.js";
import { verifyCycle } from "../engine/reconciliation.js";
import { GoalRunner } from "../engine/goal-runner.js";
import { RealClaudeProcessFactory } from "../bot/claude-process.js";
import { SessionStore } from "../bot/session-store.js";
import type { MetricMeasurer } from "../engine/evaluator.js";

/**
 * v0.4 — `solosquad goal` CLI group.
 *
 *   solosquad goal new <goal-id>
 *   solosquad goal list
 *   solosquad goal show <goal-id>
 *   solosquad goal run <goal-id> [--hours N | --cycles N]
 *   solosquad goal status [<goal-id>]
 *   solosquad goal stop <goal-id>
 *   solosquad goal verify <goal-id> --cycle <n>
 *
 * Per docs/plan/v0.4-autonomous-engine.md §6.
 */

export interface GoalNewOpts { org?: string }
export interface GoalListOpts { org?: string }
export interface GoalShowOpts { org?: string; events?: number }
export interface GoalRunOpts { org?: string; hours?: string; cycles?: string }
export interface GoalStatusOpts { org?: string }
export interface GoalStopOpts { org?: string }
export interface GoalVerifyOpts { org?: string; cycle: string }
export interface GoalQueueOpts { org?: string }
export interface GoalActiveOpts { org?: string }
export interface GoalNextOpts { org?: string }

// ---------- new ----------

export async function goalNewCommand(goalId: string | undefined, opts: GoalNewOpts): Promise<void> {
  if (!goalId) {
    console.log(chalk.red("✗ goal-id is required (kebab-case)."));
    process.exit(1);
  }
  const ws = getWorkspaceRoot();
  const orgSlug = await pickOrg(opts.org);
  if (!orgSlug) return;

  const dir = goalDir(ws, orgSlug, goalId);
  if (fs.existsSync(dir)) {
    console.log(chalk.yellow(`! ${orgSlug}/goals/${goalId}/ already exists. Edit goal.md directly.`));
    return;
  }
  fs.mkdirSync(dir, { recursive: true });
  const tpl = path.join(getAssetsDir(), "templates", "goal.md");
  let body = fs.readFileSync(tpl, "utf-8");
  body = body.replace("{{goal-id-kebab}}", goalId).replace("{{org-slug}}", orgSlug);
  fs.writeFileSync(path.join(dir, "goal.md"), body, "utf-8");

  console.log(chalk.green(`✓ Created ${dir}/goal.md`));
  console.log(chalk.dim("  1. Open goal.md and fill the {{...}} placeholders."));
  console.log(chalk.dim(`  2. solosquad goal run ${goalId}`));
}

// ---------- list ----------

export async function goalListCommand(opts: GoalListOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgs = listOrganizations(ws).filter((o) => !opts.org || o.slug === opts.org);
  if (orgs.length === 0) {
    console.log(chalk.dim("No organizations match the filter."));
    return;
  }
  for (const org of orgs) {
    const root = path.join(getOrgDir(org.slug, ws), "goals");
    console.log(chalk.cyan(`\n${org.slug}:`));
    if (!fs.existsSync(root)) {
      console.log(chalk.dim("  (no goals)"));
      continue;
    }
    const goals = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    if (goals.length === 0) {
      console.log(chalk.dim("  (no goals)"));
      continue;
    }
    for (const goalId of goals) {
      const summary = summarizeRun(ws, org.slug, goalId, {});
      const goalMd = path.join(root, goalId, "goal.md");
      let title = "(no goal.md)";
      try {
        const parsed = parseGoalFile(goalMd);
        title = parsed.title;
      } catch {
        // skip
      }
      const cycleStr = summary.cycleCount > 0
        ? `cycles=${summary.cycleCount} keep=${summary.keepCount} cost=$${summary.totalCostUsd.toFixed(4)}`
        : "not yet run";
      console.log(`  ${chalk.bold(goalId)}  ${chalk.dim("—")} ${title}  ${chalk.dim(`[${cycleStr}]`)}`);
    }
  }
  console.log();
}

// ---------- show ----------

export async function goalShowCommand(goalId: string, opts: GoalShowOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgSlug = await pickOrg(opts.org);
  if (!orgSlug) return;
  const goalMd = path.join(goalDir(ws, orgSlug, goalId), "goal.md");
  if (!fs.existsSync(goalMd)) {
    console.log(chalk.red(`✗ Goal not found: ${orgSlug}/${goalId}`));
    process.exit(1);
  }
  let goal: GoalSpec;
  try {
    goal = parseGoalFile(goalMd);
  } catch (e) {
    if (e instanceof GoalParseError) {
      console.log(chalk.red(`✗ goal.md parse error: ${e.message}`));
    } else {
      console.log(chalk.red(`✗ ${(e as Error).message}`));
    }
    process.exit(1);
  }
  const guide = loadAgentsMd(ws);
  console.log(chalk.bold(`\n${goal.goal_id}`) + chalk.dim(`  (${orgSlug})`));
  console.log(`  ${goal.title}`);
  if (goal.preamble) console.log(chalk.dim(`  ${goal.preamble.split("\n")[0]}`));
  console.log(chalk.dim(`  ${goalMd}`));

  console.log(chalk.bold(`\n  Metrics (${goal.metrics.length}):`));
  for (const m of goal.metrics) {
    console.log(
      `    ${chalk.bold(m.name)}  ${chalk.dim(m.direction)} threshold=${m.threshold}  ${chalk.dim(m.source)}`
    );
  }

  console.log(chalk.bold(`\n  Pipeline (${goal.pipeline.length} stages):`));
  for (let i = 0; i < goal.pipeline.length; i++) {
    console.log(`    ${i + 1}. ${chalk.cyan(goal.pipeline[i].agent)}  ${chalk.dim(goal.pipeline[i].task)}`);
  }

  console.log(chalk.bold("\n  Budget:"));
  if (goal.time_budget.hours != null) console.log(`    time: ${goal.time_budget.hours}h`);
  if (goal.time_budget.cycles != null) console.log(`    time: ${goal.time_budget.cycles} cycles`);
  console.log(`    cost: $${goal.cost_budget.per_cycle_usd}/cycle, $${goal.cost_budget.total_usd} total`);

  console.log(chalk.bold("\n  Signal trigger:"));
  console.log(`    auto: ${goal.signal_trigger.auto}  keywords: [${goal.signal_trigger.match_keywords.join(", ")}]`);

  console.log(chalk.bold("\n  AGENTS.md:"));
  console.log(`    ${guide.exists ? chalk.green("✓ loaded") : chalk.yellow("△ missing — defaults applied")}`);
  console.log(`    immutable=${guide.immutable_paths.length}  modifiable=${guide.modifiable_paths.length}`);

  const tsv = resultsTsvPath(ws, orgSlug, goalId);
  if (fs.existsSync(tsv)) {
    const rows = readResults(ws, orgSlug, goalId);
    const limit = opts.events ?? 8;
    console.log(chalk.bold(`\n  Recent results (last ${Math.min(limit, rows.length)} of ${rows.length} rows):`));
    for (const r of rows.slice(-limit)) {
      const c = r.status === "keep" ? chalk.green : chalk.red;
      console.log(
        `    ${chalk.dim(r.timestamp.slice(0, 19))}  cycle=${r.cycle}  ${r.metric}=${r.value}  ${c(r.status)}  ${chalk.dim(r.commit.slice(0, 8))}`
      );
    }
  } else {
    console.log(chalk.bold("\n  Recent results:"));
    console.log(chalk.dim("    (no run yet)"));
  }

  const best = readBest(ws, orgSlug, goalId);
  if (best) {
    console.log(chalk.bold("\n  Ship candidate (_best.json):"));
    console.log(`    cycle=${best.cycle}  commit=${best.commit.slice(0, 12)}  score=${best.composite_score.toFixed(4)}`);
  }
  console.log();
}

// ---------- run ----------

export async function goalRunCommand(goalId: string, opts: GoalRunOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgSlug = await pickOrg(opts.org);
  if (!orgSlug) return;
  const goalMd = path.join(goalDir(ws, orgSlug, goalId), "goal.md");
  if (!fs.existsSync(goalMd)) {
    console.log(chalk.red(`✗ Goal not found: ${orgSlug}/${goalId}`));
    console.log(chalk.dim(`  Create with: solosquad goal new ${goalId}`));
    process.exit(1);
  }
  let goal: GoalSpec;
  try {
    goal = parseGoalFile(goalMd);
  } catch (e) {
    if (e instanceof GoalParseError) {
      console.log(chalk.red(`✗ goal.md validation: ${e.message}`));
    } else {
      console.log(chalk.red(`✗ ${(e as Error).message}`));
    }
    process.exit(1);
  }

  // CLI overrides
  if (opts.hours) {
    const n = Number(opts.hours);
    if (!Number.isFinite(n) || n <= 0) {
      console.log(chalk.red("✗ --hours must be > 0"));
      process.exit(1);
    }
    goal.time_budget.hours = n;
    goal.time_budget.cycles = undefined;
  }
  if (opts.cycles) {
    const n = Number(opts.cycles);
    if (!Number.isInteger(n) || n <= 0) {
      console.log(chalk.red("✗ --cycles must be a positive integer"));
      process.exit(1);
    }
    goal.time_budget.cycles = n;
    goal.time_budget.hours = undefined;
  }

  console.log(chalk.cyan(`\nStarting goal run: ${goalId}`));
  console.log(chalk.dim(`  org: ${orgSlug}`));
  console.log(chalk.dim(`  budget: ${goal.time_budget.hours ? goal.time_budget.hours + "h" : goal.time_budget.cycles + " cycles"}, $${goal.cost_budget.total_usd} cap`));
  console.log(chalk.dim(`  pipeline: ${goal.pipeline.length} stages\n`));

  const claude = new RealClaudeProcessFactory();
  const sessions = new SessionStore(ws);
  const measurer = makePlaceholderMeasurer();

  const runner = new GoalRunner({
    workspace: ws,
    claude,
    sessions,
    measurer,
  });

  // v1.1 §12.1 — acquire the 1-active-per-org semaphore before the run.
  // If a different goal is already active, refuse and direct the user
  // toward `solosquad goal queue` so they can chain runs without
  // overrunning the org's chief session.
  const orgRoot = getOrgDir(orgSlug, ws);
  const goalQueue = await import("../util/goal-queue.js");
  const activeBefore = goalQueue.getActive({ orgRoot });
  if (activeBefore !== null && activeBefore !== goalId) {
    console.log(
      chalk.red(
        `✗ Cannot start: ${activeBefore} is already active in ${orgSlug}.`
      )
    );
    console.log(
      chalk.dim(
        `  Enqueue instead: solosquad goal queue ${goalId} --org ${orgSlug}`
      )
    );
    process.exit(1);
  }
  if (activeBefore === null) goalQueue.acquire({ orgRoot }, goalId);

  let report;
  try {
    report = await runner.run({ goal });
  } finally {
    // Always release on completion or error — leaves the slot in a sane
    // state for the next `goal next` / `goal run`.
    goalQueue.release({ orgRoot }, goalId);
  }

  // If something is queued behind us, surface it so the user can promote.
  const queuedNext = goalQueue.listQueue({ orgRoot })[0];
  if (queuedNext) {
    console.log(
      chalk.dim(
        `\n  Queue head: ${queuedNext.goal_id}. Run 'solosquad goal next' to promote.`
      )
    );
  }

  console.log(chalk.bold(`\nFinal state: ${report.state}`));
  console.log(chalk.dim(`  reason: ${report.terminationReason}`));
  console.log(`  cycles: attempted=${report.cyclesAttempted} keep=${report.cyclesKept} discard=${report.cyclesDiscarded}`);
  console.log(`  total cost: $${report.totalCostUsd.toFixed(4)}`);
  if (report.shipCandidateCommit) {
    console.log(chalk.green(`  ship candidate: ${report.shipCandidateCommit.slice(0, 12)}`));
  }
  if (report.oscillationWarning) {
    console.log(chalk.yellow("  ⚠ oscillation detected — consider widening metric thresholds."));
  }
  console.log(chalk.dim(`\n  Summary written to ${goalDir(ws, orgSlug, goalId)}/_last-run.md\n`));
}

// ---------- status ----------

export async function goalStatusCommand(goalIdMaybe: string | undefined, opts: GoalStatusOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgSlug = await pickOrg(opts.org);
  if (!orgSlug) return;
  const root = path.join(getOrgDir(orgSlug, ws), "goals");
  if (!fs.existsSync(root)) {
    console.log(chalk.dim(`No goals for ${orgSlug}.`));
    return;
  }
  const ids = goalIdMaybe
    ? [goalIdMaybe]
    : fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

  for (const id of ids) {
    const summary = summarizeRun(ws, orgSlug, id, {});
    const lastRunPath = path.join(root, id, "_last-run.md");
    const hasRun = fs.existsSync(lastRunPath);
    console.log(chalk.bold(`\n${orgSlug}/${id}`));
    console.log(`  cycles: ${summary.cycleCount}  keep: ${summary.keepCount}  discard: ${summary.discardCount}`);
    if (summary.lastCycleTimestamp) {
      console.log(chalk.dim(`  last cycle: ${summary.lastCycleTimestamp.slice(0, 19)}`));
    }
    if (summary.bestCycle) {
      console.log(`  ${chalk.green("ship candidate")} cycle ${summary.bestCycle.cycle} ${chalk.dim(summary.bestCycle.commit.slice(0, 12))}`);
    }
    if (hasRun) {
      console.log(chalk.dim(`  see ${lastRunPath} for full report`));
    }
  }
  console.log();
}

// ---------- stop ----------

export async function goalStopCommand(goalId: string, opts: GoalStopOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgSlug = await pickOrg(opts.org);
  if (!orgSlug) return;

  // v0.4 phase A: stop is implemented by rotating the dedicated bg session-id
  // so subsequent --resume calls fail. The currently in-flight Claude process
  // (if any) will continue until the cycle finishes; the runner won't start
  // the next one. We surface this caveat to the user.

  const sessions = new SessionStore(ws);
  const sessionPrefix = `bg-${goalId}-`;
  const records = sessions.listForOrg(orgSlug).filter((r) => r.userId.startsWith(sessionPrefix));
  if (records.length === 0) {
    console.log(chalk.dim(`No active background session matching ${sessionPrefix}*.`));
    return;
  }
  for (const r of records) {
    sessions.rotate(orgSlug, r.userId, `goal stop ${goalId}`);
    console.log(chalk.green(`✓ Rotated background session ${r.sessionId.slice(0, 8)} (${r.userId}).`));
  }
  console.log(chalk.dim("\n  Note: a cycle currently mid-flight will complete normally."));
  console.log(chalk.dim("  The next cycle won't start because the session-id is now invalid."));
}

// ---------- verify ----------

export async function goalVerifyCommand(goalId: string, opts: GoalVerifyOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgSlug = await pickOrg(opts.org);
  if (!orgSlug) return;
  const cycle = Number(opts.cycle);
  if (!Number.isInteger(cycle) || cycle < 1) {
    console.log(chalk.red("✗ --cycle must be a positive integer"));
    process.exit(1);
  }
  const measurer = makePlaceholderMeasurer();
  const outcome = await verifyCycle({ workspace: ws, orgSlug, goalId, cycle }, measurer);

  console.log(chalk.bold(`\nCycle ${outcome.cycle}  commit=${outcome.commit.slice(0, 12)}`));
  for (const m of outcome.metrics) {
    const valOk = m.pass ? chalk.green("✓") : chalk.red("✗");
    const statusOk = m.statusMatch ? chalk.green("✓") : chalk.red("✗");
    console.log(
      `  ${m.name}: recorded=${m.recorded}  replayed=${m.replayed}  delta=${m.delta.toExponential(2)}  ${valOk} value  ${statusOk} status`
    );
  }
  console.log(
    `\n  ${outcome.deterministic ? chalk.green("✓ deterministic") : chalk.red("✗ NON-deterministic — investigate provenance")}\n`
  );
}

// ---------- helpers ----------

// ---------- queue / active / next (v1.1 §12.1) ----------

export async function goalQueueCommand(
  goalId: string | undefined,
  opts: GoalQueueOpts
): Promise<void> {
  if (!goalId) {
    console.log(chalk.red("✗ goal-id is required."));
    process.exit(1);
  }
  const ws = getWorkspaceRoot();
  const orgSlug = await pickOrg(opts.org);
  if (!orgSlug) return;
  const orgRoot = getOrgDir(orgSlug, ws);
  const { enqueue, getActive, listQueue } = await import(
    "../util/goal-queue.js"
  );
  enqueue({ orgRoot }, goalId);
  const active = getActive({ orgRoot });
  const queue = listQueue({ orgRoot });
  console.log(chalk.green(`✓ Enqueued ${goalId} (org ${orgSlug})`));
  if (active) {
    console.log(chalk.dim(`  active: ${active}`));
  } else {
    console.log(
      chalk.dim(
        `  no goal is currently active — run 'solosquad goal next' to promote.`
      )
    );
  }
  console.log(chalk.dim(`  queue depth: ${queue.length}`));
}

export async function goalActiveCommand(opts: GoalActiveOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgSlug = await pickOrg(opts.org);
  if (!orgSlug) return;
  const orgRoot = getOrgDir(orgSlug, ws);
  const { getActive, listQueue } = await import("../util/goal-queue.js");
  const active = getActive({ orgRoot });
  const queue = listQueue({ orgRoot });
  if (active) {
    console.log(chalk.cyan(`active: ${active}`));
  } else {
    console.log(chalk.dim("(no active goal)"));
  }
  if (queue.length > 0) {
    console.log(chalk.dim(`queued (${queue.length}):`));
    for (const entry of queue) {
      console.log(chalk.dim(`  - ${entry.goal_id}  (${entry.enqueued_at})`));
    }
  } else {
    console.log(chalk.dim("queue: (empty)"));
  }
}

export async function goalNextCommand(opts: GoalNextOpts): Promise<void> {
  const ws = getWorkspaceRoot();
  const orgSlug = await pickOrg(opts.org);
  if (!orgSlug) return;
  const orgRoot = getOrgDir(orgSlug, ws);
  const { getActive, promoteNext } = await import("../util/goal-queue.js");
  if (getActive({ orgRoot }) !== null) {
    console.log(
      chalk.yellow(
        `✗ A goal is already active in ${orgSlug}. Run 'solosquad goal stop <id>' or wait for it to finish.`
      )
    );
    return;
  }
  const promoted = promoteNext({ orgRoot });
  if (!promoted) {
    console.log(chalk.dim("(queue is empty — nothing to promote)"));
    return;
  }
  console.log(chalk.green(`✓ Promoted ${promoted} → active`));
  console.log(
    chalk.dim(`  next step: solosquad goal run ${promoted} --org ${orgSlug}`)
  );
}

async function pickOrg(orgArg: string | undefined): Promise<string | null> {
  const ws = getWorkspaceRoot();
  const orgs = listOrganizations(ws);
  if (orgs.length === 0) {
    console.log(chalk.red("No organizations in this workspace."));
    return null;
  }
  if (orgArg) {
    if (!orgs.some((o) => o.slug === orgArg)) {
      console.log(chalk.red(`✗ Org not found: ${orgArg}`));
      return null;
    }
    return orgArg;
  }
  if (orgs.length === 1) return orgs[0].slug;
  const { pick } = await inquirer.prompt([
    {
      type: "list",
      name: "pick",
      message: "Which organization?",
      choices: orgs.map((o) => ({ name: o.slug, value: o.slug })),
    },
  ]);
  return pick as string;
}

/**
 * v0.4 phase A measurer. Returns a deterministic value derived from the
 * metric.source file's mtime + size hash. Real measurement (formula
 * evaluation against the source) is v0.4.x patch — for the initial release
 * the measurer is enough to drive the cycle loop end-to-end. Tests
 * substitute a scripted measurer.
 */
function makePlaceholderMeasurer(): MetricMeasurer {
  return {
    async measure(spec, ctx) {
      // Deterministic: hash (source path + provenance). Same inputs ⇒ same value.
      const seed = `${spec.source}|${spec.formula}|${ctx.commitSha ?? ""}`;
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
      // Map to [0, 1)
      const value = (h % 1_000_000) / 1_000_000;
      const provenance = `formula=${spec.formula};source=${spec.source}`;
      return { spec, value, provenance };
    },
  } satisfies MetricMeasurer;
}

// Touch unused imports to keep static analyzers quiet.
void path;
void inquirer;
// MetricSpec import is type-only; no runtime touch needed.

