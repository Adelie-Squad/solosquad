// The workflow card's timeline (DESIGN.md `## 랜딩` — 워크플로우, 2026-11-14 ②: "워크플로우에서 타이핑하는
// 프롬프트 창 가져와서 넣고 각 에이전트에게 업무 할당되는 걸로 시각화"): the request types itself into the
// prompt box (the penguin patters over the card's top edge — the `type` act), then Chief hands each
// agent its piece of work one after another (a line drawn to the agent, a task chip set down beside
// it), then the team approval lights up and the owner's approve button takes the stamp's mark (a UI
// animation — the section's act is the typing). Plain numbers, so the timing is testable.
import type { StampState } from './acting';

/** One character every this many ms — but the whole request in at most `TYPE_MAX_MS`. */
export const TYPE_MS = 70;
export const TYPE_MAX_MS = 2400;
/** Typed: held this long before Chief starts handing out the work. */
export const HOLD_TYPED_MS = 400;
/** The first piece goes out this long after the hold; the next ones this far apart. */
export const ASSIGN_FIRST_MS = 300;
export const ASSIGN_STEP_MS = 650;
/** All handed out: the team approval lights up after this; the owner's stamp after that. */
export const TEAM_MS = 700;
export const STAMP_MS = 900;
/** From the stamp's hit to "승인했어요". */
export const APPROVED_AFTER_MS = 260;

export const charMs = (chars: number) => (chars > 0 ? Math.min(TYPE_MS, TYPE_MAX_MS / chars) : TYPE_MS);

export type PieceState = 'waiting' | 'on' | 'done';

export interface FlowFrame {
  /** characters of the request shown */
  typed: number;
  /** the box is typing right now (the penguin patters) */
  typing: boolean;
  /** each piece of work: not handed out yet · going out now · set down */
  pieces: PieceState[];
  /** the team approval is up */
  team: boolean;
  stamp: StampState;
  /** nothing more will change */
  done: boolean;
}

/** The card `ms` after the timeline started (`ms < 0` = not started: nothing typed, nothing handed out). */
export function flowAt(ms: number, chars: number, pieces: number): FlowFrame {
  const per = charMs(chars);
  const typeEnd = chars * per;
  const typed = ms < 0 ? 0 : Math.min(chars, Math.floor(ms / per));
  const assignStart = typeEnd + HOLD_TYPED_MS + ASSIGN_FIRST_MS;
  const states: PieceState[] = [];
  for (let i = 0; i < pieces; i++) {
    const at = assignStart + i * ASSIGN_STEP_MS;
    states.push(ms < at ? 'waiting' : ms < at + ASSIGN_STEP_MS ? 'on' : 'done');
  }
  const allAt = assignStart + pieces * ASSIGN_STEP_MS;
  const teamAt = allAt + TEAM_MS;
  const hitAt = teamAt + STAMP_MS;
  const stamp: StampState = ms < hitAt ? 'waiting' : ms < hitAt + APPROVED_AFTER_MS ? 'pressed' : 'approved';
  return { typed, typing: ms >= 0 && ms < typeEnd, pieces: states, team: ms >= teamAt, stamp, done: ms >= hitAt + APPROVED_AFTER_MS };
}

/** The finished picture (not acting · reduced motion · the stacked page): typed, handed out, waiting for the owner. */
export const flowStill = (chars: number, pieces: number): FlowFrame => ({ typed: chars, typing: false, pieces: Array(pieces).fill('done'), team: true, stamp: 'waiting', done: true });

/** How long the whole timeline runs (ms). */
export const flowLength = (chars: number, pieces: number) => chars * charMs(chars) + HOLD_TYPED_MS + ASSIGN_FIRST_MS + pieces * ASSIGN_STEP_MS + TEAM_MS + STAMP_MS + APPROVED_AFTER_MS;
