import {
  readEvents,
  type ChiefStage,
  type ChiefStageEvent,
} from "../util/chief-stage-events.js";

/**
 * v1.2 §8 — Chief-stage-events.jsonl → thread narration.
 *
 * Pure formatter — given a turn id + org root, returns the ordered
 * sequence of messages that should be posted into the works thread for
 * that turn. No Discord API contact; the caller (discord-task-card.ts)
 * is responsible for actually sending.
 *
 * Format (per PRD §8.1 / §8.2):
 *   DECOMPOSE → "🗂 작업 분해 중..."
 *   DISPATCH → "📤 dispatch: pm, engineer (병렬 2)"
 *   AWAIT (open_questions) → "❓ 추가 정보 필요" (the actual questions
 *     come from the open-questions/ json files, formatted upstream)
 *   SYNTHESIZE / TRIAGE / DECIDE / RETROSPECT → omitted from the
 *     thread feed (the Chief reply text itself already covers them).
 *
 * Sub-agent skills_used entries get a follow-on bullet line.
 */

const STAGE_FORMATTERS: Partial<
  Record<ChiefStage, (event: ChiefStageEvent) => string | null>
> = {
  DECOMPOSE: () => "🗂 작업 분해 중...",
  DISPATCH: (e) => {
    const names = e.dispatched ?? [];
    if (names.length === 0) return "📤 dispatch (no sub-agents recorded)";
    const count = names.length;
    return `📤 dispatch: ${names.join(", ")}${count > 1 ? ` (병렬 ${count})` : ""}`;
  },
  AWAIT: (e) => {
    if (!e.detail || !e.detail.toLowerCase().includes("open_question")) {
      return null;
    }
    return `❓ ${e.detail}`;
  },
};

export interface StageNarrationLine {
  /** Underlying stage that produced this line (for logging/tests). */
  stage: ChiefStage;
  /** Display text — ready to send to Discord (≤ 2000 chars). */
  text: string;
}

/**
 * Project a single stage event into 0..n narration lines. Returns `[]` for
 * non-projected stages (TRIAGE / SYNTHESIZE / DECIDE / RETROSPECT — the Chief
 * reply already covers them) and for projected stages whose formatter declines
 * (e.g. an AWAIT with no open_questions). `skills_used` becomes a `↳ …`
 * follow-on bullet.
 *
 * v1.3.0 Part C (P0) — this is the single source of truth for stage → line
 * formatting, shared by the batch path (`buildStageNarration`) and the live
 * path (the dispatcher's `onStage` callback). Both MUST render identically.
 */
export function formatStageEvent(event: ChiefStageEvent): StageNarrationLine[] {
  const formatter = STAGE_FORMATTERS[event.stage];
  if (!formatter) return [];
  const text = formatter(event);
  if (text === null) return [];
  const lines: StageNarrationLine[] = [{ stage: event.stage, text }];
  if (event.skills_used && event.skills_used.length > 0) {
    lines.push({
      stage: event.stage,
      text: `  ↳ ${event.skills_used.join(", ")}`,
    });
  }
  return lines;
}

/**
 * Build the narration line list for a turn. Skips stages we don't
 * project (TRIAGE / SYNTHESIZE / DECIDE / RETROSPECT — these are
 * already represented by the Chief reply itself), and silently drops
 * stages whose formatter returns null. `skills_used` entries on any
 * stage are appended as `↳ skill1, skill2` follow-ons.
 */
export function buildStageNarration(
  orgRoot: string,
  turnId: string,
): StageNarrationLine[] {
  const events = readEvents({ orgRoot }, { turn_id: turnId });
  const lines: StageNarrationLine[] = [];
  for (const event of events) {
    lines.push(...formatStageEvent(event));
  }
  return lines;
}

/**
 * Convenience — flatten StageNarrationLine[] into the string[] format
 * that discord-task-card.ts expects.
 */
export function narrationLinesAsStrings(
  lines: StageNarrationLine[],
): string[] {
  return lines.map((l) => l.text);
}
