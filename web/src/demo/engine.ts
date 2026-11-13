// The demo's in-browser engine (2026-11-13 — the demo is frontend-only): the example company 모아
// 리빙 from `data/<locale>.json` and the three scripted workflows (재무 · 소싱 · SNS), answered the
// way the engine's web API answers, from memory. Nothing is saved anywhere — a reload starts over.
//
// A workflow run walks its steps on a timer: an agent step streams its scripted reply (~3 s, so
// the office shows that agent at work), a tool step returns its prepared work product (~1.5 s),
// an approval step stops the run with its card (decision 51: team approval, then the owner's).
// Approve goes on; decline takes the step's `on_decline` branch. The chat matches a request to
// one of the scripted intents and starts its workflow. Yesterday's runs are played once, instantly,
// when the engine is made, so the dashboard and the history are not empty.
import type {
  Agent,
  ApprovalCard,
  ApprovalItem,
  Artifact,
  CalendarDetail,
  CalendarItem,
  CalendarList,
  CalendarTodo,
  ChatMessage,
  Company,
  LegalEntity,
  Digest,
  DigestDecision,
  DigestWork,
  EngineEvent,
  Interrupt,
  Me,
  OrgChart,
  OrgPerson,
  PublicUser,
  Run,
  Thread,
  WorkEntry,
  WorkflowSummary,
} from '../api/types.gen';

export type DemoLocale = 'ko' | 'en' | 'zh-CN';

export interface StepDef {
  id: string;
  title: string;
  type: 'agent' | 'tool' | 'approval';
  agent?: string;
  reply?: string;
  prompt?: string;
  output?: Record<string, unknown>;
  approval?: { title: string; summary: string; risk: string; category: string; on_decline: string | null };
  save_as?: { kind: string; title: string };
  end?: boolean;
}

export interface WorkflowDef {
  name: string;
  title: string;
  description: string;
  team: string | null;
  steps: StepDef[];
}

export interface Intent {
  key: string;
  words: string[];
  chief: string;
  scenario: string | null;
  handoff: string | null;
  answer: string | null;
}

/** `data/<locale>.json` — written once from the engine's demo mode (its content and its API's answers). */
export interface DemoData {
  locale: DemoLocale;
  captured: number;
  org: { id: string; display: string; ws: string; ws_display: string };
  owner_title: string;
  company: Company;
  server: unknown;
  snapshot: unknown;
  access: unknown;
  ws_access: unknown;
  users: PublicUser[];
  people: OrgPerson[];
  teams: unknown;
  org_chart: OrgChart;
  approval_policy: { category: string; tier: 'owner' | 'team' }[];
  screens: Record<string, unknown>;
  agents: Agent[];
  budget: unknown;
  schedules: unknown;
  calendar: {
    labels: unknown;
    items: CalendarItem[];
    details: Record<string, CalendarDetail>;
    agent_access: unknown;
  };
  workflows: WorkflowDef[];
  replies: Record<string, string>;
  handing: Record<string, string>;
  step_done: string;
  chat: { intents: Intent[]; fallback: string; suggestions: string[] };
  past_chat: { title: string; request: string };
}

export interface DemoAccount {
  demoId: string;
  companyName: string;
  /** the account's end, epoch seconds; null = no end (an internal account) */
  expires: number | null;
}

export interface Pace {
  /** ms an agent step streams for */
  agentMs: number;
  /** ms a tool step takes */
  toolMs: number;
  /** ms a chat answer streams for */
  chatMs: number;
}

export const LIVE_PACE: Pace = { agentMs: 3000, toolMs: 1500, chatMs: 1500 };

export interface Answer {
  status: number;
  body: unknown;
}

type Listener = (ev: EngineEvent, id: number) => void;

interface WfThread {
  id: string;
  workflow: string;
  title: string;
  created: number;
  updated: number;
  step: number;
  outputs: Record<string, unknown>;
  artifacts: string[];
  status: string;
  interrupts: Interrupt[];
  agents: string[];
  /** started by the visitor (not the history seeded before they came) — its end is a usage event */
  live?: boolean;
  /** an approval in this run was declined */
  declined?: boolean;
  /** its `workflow_done` went out (once per run) */
  reported?: boolean;
}

/** The workflow's short name in the usage events (`workflow_started:<id>` · `workflow_done:<id>:<outcome>`)
 * — the marketing Worker allows only these (marketing/src/demo.ts `workflowDetailOk`). */
export const WORKFLOW_EVENT_ID: Record<string, 'finance' | 'sourcing' | 'sns'> = {
  'finance-monthly': 'finance',
  'product-sourcing': 'sourcing',
  'sns-marketing': 'sns',
};

interface ChatThread extends Thread {
  messages: ChatMessage[];
  active_agent: string | null;
}

const OWNER_ID = 'u-demo-owner';
const hex = (n = 12) => Array.from(crypto.getRandomValues(new Uint8Array(n / 2)), (b) => b.toString(16).padStart(2, '0')).join('');
const STEP_TAG = /\{\{\s*steps\.([a-z0-9_]+)\.([a-z0-9_]+)\s*\}\}/gi;
const DAY = 86_400;

/** "<title> 2026-11-13 01:07" — how the engine names a workflow run. */
function runTitle(title: string, at: number): string {
  const d = new Date(at * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${title} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Move the calendar's dates and times so "today" in the data is the visitor's today. */
function rebase<T>(value: T, days: number, seconds: number): T {
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
    if (!m) return value;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
    return `${isoDay(d)}${m[4]}` as T;
  }
  if (Array.isArray(value)) return value.map((v) => rebase(v, days, seconds)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = (k === 'created' || k === 'updated') && typeof v === 'number' ? v + seconds : rebase(v, days, seconds);
    return out as T;
  }
  return value;
}

const chunks = (text: string, n: number): string[] => {
  const words = text.split(/(\s+)/);
  if (n <= 1 || words.length <= 1) return [text];
  const size = Math.max(1, Math.floor(words.length / n));
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(''));
  return out;
};

const err = (status: number, code: string): Answer => ({ status, body: { error: code, code, params: {} } });
const ok = (body: unknown): Answer => ({ status: 200, body });

export class DemoEngine {
  readonly data: DemoData;
  readonly account: DemoAccount;
  private pace: Pace;
  private now: () => number;
  private listeners = new Set<Listener>();
  private eventId = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private stopped = false;

  private chats = new Map<string, ChatThread>();
  private agentThreads = new Map<string, ChatThread>();
  private companyRuns: Run[] = [];
  private wfThreads = new Map<string, WfThread>();
  private wfRuns: Run[] = [];
  private artifacts: Artifact[] = [];
  private decisions: DigestDecision[] = [];
  /** agent → the runs it is answering now */
  private working = new Map<string, { thread_id: string; run_id: string; title: string | null }[]>();
  private locale: DemoLocale;
  private digestSince: number;
  private digestBasis: Digest['basis'] = 'away';
  private calendar: { items: CalendarItem[]; details: Record<string, CalendarDetail> };
  /** what the visitor pressed — usage, sent by the page (never what they typed) */
  onAction: (detail: string) => void = () => {};

  constructor(data: DemoData, account: DemoAccount, opts: { pace?: Pace; now?: () => number } = {}) {
    this.data = data;
    this.account = account;
    this.pace = opts.pace ?? LIVE_PACE;
    this.now = opts.now ?? (() => Date.now() / 1000);
    this.locale = data.locale;
    const t = this.now();
    const captured = new Date(data.captured * 1000);
    const today = new Date(t * 1000);
    const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(captured.getFullYear(), captured.getMonth(), captured.getDate()).getTime()) / 86_400_000);
    this.calendar = rebase({ items: data.calendar.items, details: data.calendar.details }, days, t - data.captured);
    this.digestSince = t - 22 * 3600;
    this.seedYesterday(t - 18 * 3600);
  }

  stop(): void {
    this.stopped = true;
    for (const h of this.timers) clearTimeout(h);
    this.timers.clear();
    this.listeners.clear();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ------------------------------------------------------------------ time and events

  private later(ms: number, fn: () => void): void {
    if (this.stopped) return;
    const h = setTimeout(() => {
      this.timers.delete(h);
      if (!this.stopped) fn();
    }, ms);
    this.timers.add(h);
  }

  private emit(ev: Omit<EngineEvent, 'ts'>): void {
    const full = { ts: this.now(), ...ev } as EngineEvent;
    this.eventId += 1;
    for (const fn of [...this.listeners]) fn(full, this.eventId);
  }

  // ------------------------------------------------------------------ yesterday

  /** Each workflow once, answered (SNS's ad payment declined), and one conversation — all
   * finished before the visitor arrived. */
  private seedYesterday(at: number): void {
    let clock = at;
    const tick = (s: number) => (clock += s);
    const answers: Record<string, Record<string, 'approved' | 'declined'>> = { 'sns-marketing': { ad_spend: 'declined' } };
    const approvers: Record<string, string> = {};
    for (const p of this.data.people) {
      if (p.teams.includes('business')) approvers.review = p.display;
      if (p.teams.includes('brand')) approvers.publish = p.display;
    }
    const owner = this.ownerName();
    for (const wf of this.data.workflows) {
      const th = this.newWfThread(wf, clock);
      let run = this.newWfRun(th, 'input', { workflow: wf.name, inputs: {} }, clock, 'seed');
      let i = 0;
      while (i < wf.steps.length) {
        const st = wf.steps[i];
        tick(st.type === 'agent' ? 4 : 2);
        th.step = i;
        if (st.type === 'approval') {
          const card = this.card(wf, st, th);
          const value = answers[wf.name]?.[st.id] ?? 'approved';
          run.status = 'superseded';
          run.interrupts = [{ id: `seed-${hex()}`, value: card }];
          run.ended = clock;
          const next = this.newWfRun(th, 'resume', value, clock, 'seed');
          run.superseded_by = next.id;
          run = next;
          th.outputs[st.id] = { decision: value };
          this.decisions.push({
            org: this.data.org.id,
            workspace: this.data.org.ws,
            ts: clock,
            approver: approvers[st.approval?.category ?? ''] ?? owner,
            decision: value,
            source: 'workflow',
            thread_id: th.id,
            title: th.title,
            category: st.approval?.category ?? null,
          });
          i = value === 'declined' && st.approval?.on_decline ? wf.steps.findIndex((s) => s.id === st.approval!.on_decline) : i + 1;
          continue;
        }
        if (st.type === 'agent') {
          const text = this.replyFor(st);
          const agentThread = this.agentThreadFor(th, clock);
          agentThread.messages.push(this.userMessage(this.jobText(st)), this.agentMessage(st.agent ?? 'chief', text));
          agentThread.updated = clock;
          this.companyRuns.unshift(this.finishedRun(agentThread.id, 'message', this.jobText(st), clock - 3, clock, 'workflow'));
          th.outputs[st.id] = { text, agent: st.agent };
          if (!th.agents.includes(st.agent!)) th.agents.push(st.agent!);
          if (st.save_as) this.addArtifact(th, st, { text, agent: st.agent }, clock, false);
        } else if (st.type === 'tool' && st.output) {
          th.outputs[st.id] = st.output;
          if (st.save_as) this.addArtifact(th, st, st.output, clock, false);
        }
        if (st.end) break;
        i += 1;
      }
      th.status = 'done';
      th.updated = clock;
      run.status = 'success';
      run.ended = clock;
      tick(60);
    }
    // the example conversation
    const intent = this.match(this.data.past_chat.request);
    const tid = `th-${hex()}`;
    const chat: ChatThread = { id: tid, title: this.data.past_chat.title, metadata: {}, created: clock, updated: clock + 2, messages: [], active_agent: null };
    chat.messages.push(this.userMessage(this.data.past_chat.request));
    this.answerMessages(chat, intent, this.data.past_chat.request);
    this.chats.set(tid, chat);
    this.companyRuns.unshift(this.finishedRun(tid, 'message', this.data.past_chat.request, clock, clock + 2, 'chat'));
  }

  // ------------------------------------------------------------------ pieces

  private ownerName(): string {
    return this.account.demoId;
  }

  private replyFor(st: StepDef): string {
    return (st.reply && this.data.replies[st.reply]) || this.data.step_done;
  }

  private jobText(st: StepDef): string {
    return `[workflow job for ${st.agent}] ${st.prompt ?? ''}`.trim();
  }

  private userMessage(text: string): ChatMessage {
    return { id: `in-${hex()}`, role: 'user', name: null, parts: [{ kind: 'text', text }] };
  }

  private agentMessage(agent: string, text: string): ChatMessage {
    return { id: hex(32), role: 'assistant', name: agent, parts: [{ kind: 'text', text }] };
  }

  private finishedRun(thread: string, kind: string, input: unknown, start: number, end: number, source: string): Run {
    return { id: `run-${hex()}`, thread_id: thread, status: 'success', kind, input, error: null, interrupts: null, created: start, started: start, ended: end, source, superseded_by: null };
  }

  private newWfThread(wf: WorkflowDef, at: number): WfThread {
    const th: WfThread = { id: `th-${hex()}`, workflow: wf.name, title: runTitle(wf.title, at), created: at, updated: at, step: 0, outputs: {}, artifacts: [], status: 'running', interrupts: [], agents: [] };
    this.wfThreads.set(th.id, th);
    return th;
  }

  private newWfRun(th: WfThread, kind: string, input: unknown, at: number, source: string): Run {
    const run: Run = { id: `run-${hex()}`, thread_id: th.id, status: 'running', kind, input, error: null, interrupts: null, created: at, started: at, ended: null, source, superseded_by: null };
    this.wfRuns.unshift(run);
    return run;
  }

  private agentThreadFor(th: WfThread, at: number): ChatThread {
    const id = `${th.id}-agent`;
    let t = this.agentThreads.get(id);
    if (!t) {
      t = { id, title: 'workflow step', metadata: { workflow_thread: th.id }, created: at, updated: at, messages: [], active_agent: null };
      this.agentThreads.set(id, t);
    }
    return t;
  }

  private render(text: string, th: WfThread): string {
    return text.replace(STEP_TAG, (_m, step: string, key: string) => {
      const out = th.outputs[step] as Record<string, unknown> | undefined;
      const v = out?.[key];
      return v === undefined || v === null ? '' : String(v);
    });
  }

  private card(wf: WorkflowDef, st: StepDef, th: WfThread): ApprovalCard {
    const a = st.approval!;
    const title = this.render(a.title, th);
    return {
      kind: 'approval',
      title,
      summary: this.render(a.summary, th),
      reason: title,
      options: ['approved', 'declined'],
      risk: a.risk,
      agent: `workflow:${wf.name}`,
      signature: null,
      category: a.category,
      team: wf.team,
      workflow: wf.name,
      step: st.id,
    };
  }

  private tier(category: string): 'owner' | 'team' {
    return this.data.approval_policy.find((r) => r.category === category)?.tier ?? 'owner';
  }

  private addArtifact(th: WfThread, st: StepDef, data: Record<string, unknown>, at: number, live: boolean): Artifact {
    const review = (data.needs_review as unknown[] | undefined)?.length ?? 0;
    const art: Artifact = {
      id: `art-${hex()}`,
      kind: st.save_as!.kind,
      title: st.save_as!.title,
      data,
      thread_id: th.id,
      run_id: this.latestWfRun(th.id)?.id ?? null,
      workflow: th.workflow,
      // a P&L with rows to check waits for someone to look — yesterday's was looked at
      needs_review: live && st.save_as!.kind === 'finance.pnl' && review > 0,
      reviewed_by: null,
      created: at,
      schema_version: 1,
    };
    this.artifacts.unshift(art);
    th.artifacts.push(art.id);
    return art;
  }

  private latestWfRun(tid: string): Run | undefined {
    return this.wfRuns.find((r) => r.thread_id === tid);
  }

  private def(name: string): WorkflowDef | undefined {
    return this.data.workflows.find((w) => w.name === name);
  }

  private setWorking(agent: string, item: { thread_id: string; run_id: string; title: string | null } | null, runId?: string) {
    const list = (this.working.get(agent) ?? []).filter((w) => w.run_id !== (item?.run_id ?? runId));
    if (item) list.push(item);
    this.working.set(agent, list);
  }

  // ------------------------------------------------------------------ live workflows

  /** Start a workflow now → its thread and first run. */
  runNow(name: string): { thread_id: string; run_id: string } | null {
    const wf = this.def(name);
    if (!wf) return null;
    const at = this.now();
    const th = this.newWfThread(wf, at);
    th.live = true;
    const id = WORKFLOW_EVENT_ID[wf.name];
    if (id) this.onAction(`workflow_started:${id}`);
    const run = this.newWfRun(th, 'input', { workflow: wf.name, inputs: {} }, at, 'web');
    run.status = 'pending';
    run.started = null;
    this.emit({ event: 'run.created', run_id: run.id, thread_id: th.id, source: 'workflow' });
    this.later(200, () => {
      run.status = 'running';
      run.started = this.now();
      this.emit({ event: 'run.started', run_id: run.id, thread_id: th.id, source: 'workflow' });
      this.step(wf, th, run, 0);
    });
    return { thread_id: th.id, run_id: run.id };
  }

  private step(wf: WorkflowDef, th: WfThread, run: Run, i: number): void {
    if (i < 0 || i >= wf.steps.length) return this.finish(th, run);
    const st = wf.steps[i];
    th.step = i;
    th.updated = this.now();
    this.emit({ event: 'run.update', run_id: run.id, thread_id: th.id, node: 'step', summary: { text: null, active_agent: null, pending_approval: null, step: st.id }, source: 'workflow' });
    const next = () => (st.end ? this.finish(th, run) : this.step(wf, th, run, i + 1));
    if (st.type === 'approval') {
      const card = this.card(wf, st, th);
      run.status = 'interrupted';
      run.interrupts = [{ id: `int-${hex()}`, value: card }];
      run.ended = this.now();
      th.interrupts = run.interrupts;
      this.emit({ event: 'run.interrupted', run_id: run.id, thread_id: th.id, interrupts: run.interrupts, source: 'workflow' });
      return;
    }
    if (st.type === 'tool') {
      this.later(this.pace.toolMs, () => {
        if (st.output) {
          th.outputs[st.id] = st.output;
          if (st.save_as) this.addArtifact(th, st, st.output, this.now(), true);
        }
        next();
      });
      return;
    }
    // an agent step: its own company run on the workflow's agent thread, streamed
    const agent = st.agent ?? 'chief';
    const text = this.replyFor(st);
    const at = this.agentThreadFor(th, this.now());
    const job = this.jobText(st);
    at.messages.push(this.userMessage(job));
    const arun: Run = { id: `run-${hex()}`, thread_id: at.id, status: 'running', kind: 'message', input: job, error: null, interrupts: null, created: this.now(), started: this.now(), ended: null, source: 'workflow', superseded_by: null };
    this.companyRuns.unshift(arun);
    this.setWorking(agent, { thread_id: at.id, run_id: arun.id, title: th.title });
    if (!th.agents.includes(agent)) th.agents.push(agent);
    this.emit({ event: 'run.created', run_id: arun.id, thread_id: at.id });
    this.emit({ event: 'run.started', run_id: arun.id, thread_id: at.id });
    this.stream(arun, at.id, agent, text, this.pace.agentMs, () => {
      at.messages.push(this.agentMessage(agent, text));
      at.updated = this.now();
      arun.status = 'success';
      arun.ended = this.now();
      this.setWorking(agent, null, arun.id);
      this.emit({ event: 'run.update', run_id: arun.id, thread_id: at.id, node: agent, summary: { text, active_agent: null, pending_approval: null, step: null } });
      this.emit({ event: 'run.completed', run_id: arun.id, thread_id: at.id });
      th.outputs[st.id] = { text, agent };
      if (st.save_as) this.addArtifact(th, st, { text, agent }, this.now(), true);
      next();
    });
  }

  private stream(run: Run, tid: string, agent: string, text: string, ms: number, done: () => void): void {
    const parts = chunks(text, 8);
    const each = ms / parts.length;
    parts.forEach((part, n) => this.later(each * (n + 1), () => this.emit({ event: 'run.message', run_id: run.id, thread_id: tid, agent, text: part })));
    this.later(ms + 50, done);
  }

  private finish(th: WfThread, run: Run): void {
    // the KPI's "ran a workflow to the end" (2026-11-14): once per run the visitor started
    const id = WORKFLOW_EVENT_ID[th.workflow];
    if (th.live && !th.reported && id) {
      th.reported = true;
      this.onAction(`workflow_done:${id}:${th.declined ? 'declined' : 'approved'}`);
    }
    th.status = 'done';
    th.interrupts = [];
    th.updated = this.now();
    run.status = 'success';
    run.ended = this.now();
    this.emit({ event: 'run.update', run_id: run.id, thread_id: th.id, node: 'step', summary: { text: null, active_agent: null, pending_approval: null, step: null }, source: 'workflow' });
    this.emit({ event: 'run.completed', run_id: run.id, thread_id: th.id, source: 'workflow' });
  }

  /** Answer the card a workflow waits at. */
  resume(tid: string, value: string): { run_id: string } | null {
    const th = this.wfThreads.get(tid);
    const wf = th ? this.def(th.workflow) : undefined;
    const waiting = th ? this.latestWfRun(tid) : undefined;
    if (!th || !wf || !waiting || waiting.status !== 'interrupted') return null;
    const st = wf.steps[th.step];
    const decision = value === 'declined' ? 'declined' : 'approved';
    if (decision === 'declined') th.declined = true;
    const run = this.newWfRun(th, 'resume', decision, this.now(), 'web');
    waiting.status = 'superseded';
    waiting.superseded_by = run.id;
    th.interrupts = [];
    th.outputs[st.id] = { decision };
    this.decisions.unshift({
      org: this.data.org.id,
      workspace: this.data.org.ws,
      ts: this.now(),
      approver: this.ownerName(),
      decision,
      source: 'workflow',
      thread_id: th.id,
      title: th.title,
      category: st.approval?.category ?? null,
    });
    this.emit({ event: 'run.created', run_id: run.id, thread_id: th.id, source: 'workflow' });
    this.emit({ event: 'run.started', run_id: run.id, thread_id: th.id, source: 'workflow' });
    const target = decision === 'declined' ? (st.approval?.on_decline ? wf.steps.findIndex((s) => s.id === st.approval!.on_decline) : -1) : th.step + 1;
    this.later(300, () => (target < 0 ? this.finish(th, run) : this.step(wf, th, run, target)));
    return { run_id: run.id };
  }

  // ------------------------------------------------------------------ conversations

  private match(text: string): Intent | null {
    const low = text.toLowerCase();
    return this.data.chat.intents.find((i) => i.words.some((w) => low.includes(w))) ?? null;
  }

  /** Chief's reply as finished messages — with the hand-off call when an agent owns the request. */
  private chiefMessages(chat: ChatThread, intent: Intent | null, said: string): void {
    const msg = this.agentMessage('chief', intent?.chief ?? this.data.chat.fallback);
    chat.active_agent = 'chief';
    if (!intent?.handoff) {
      chat.messages.push(msg);
      return;
    }
    const call = `call-${hex(8)}`;
    msg.parts.push({ kind: 'tool_call', id: call, name: `transfer_to_${intent.handoff}`, arguments: { task: said } });
    chat.messages.push(msg, { id: hex(32), role: 'tool', name: `transfer_to_${intent.handoff}`, parts: [{ kind: 'tool_result', tool_call_id: call, content: `Successfully transferred to ${intent.handoff}`, is_error: false }] });
  }

  private answerMessages(chat: ChatThread, intent: Intent | null, said: string): void {
    this.chiefMessages(chat, intent, said);
    if (intent?.handoff && intent.answer) {
      chat.messages.push(this.agentMessage(intent.handoff, intent.answer));
      chat.active_agent = intent.handoff;
    }
  }

  newThread(title: string | null): string {
    const id = `th-${hex()}`;
    const at = this.now();
    this.chats.set(id, { id, title, metadata: {}, created: at, updated: at, messages: [], active_agent: null });
    return id;
  }

  /** A request in a conversation: Chief answers from the script (and starts the workflow it names). */
  say(tid: string, input: string): { run_id: string } | null {
    const chat = this.chats.get(tid);
    if (!chat) return null;
    const at = this.now();
    if (!chat.title) chat.title = input.slice(0, 40);
    chat.messages.push(this.userMessage(input));
    chat.updated = at;
    const run: Run = { id: `run-${hex()}`, thread_id: tid, status: 'running', kind: 'message', input, error: null, interrupts: null, created: at, started: at, ended: null, source: 'web', superseded_by: null };
    this.companyRuns.unshift(run);
    const intent = this.match(input);
    this.onAction(`chat:${intent?.key ?? 'other'}`);
    this.setWorking('chief', { thread_id: tid, run_id: run.id, title: chat.title });
    this.emit({ event: 'run.created', run_id: run.id, thread_id: tid });
    this.emit({ event: 'run.started', run_id: run.id, thread_id: tid });
    const close = (r: Run, agent: string) => {
      chat.updated = this.now();
      r.status = 'success';
      r.ended = this.now();
      this.setWorking(agent, null, r.id);
      this.emit({ event: 'run.update', run_id: r.id, thread_id: tid, node: agent, summary: { text: null, active_agent: agent, pending_approval: null, step: null } });
      this.emit({ event: 'run.completed', run_id: r.id, thread_id: tid });
    };
    this.stream(run, tid, 'chief', intent?.chief ?? this.data.chat.fallback, this.pace.chatMs, () => {
      this.chiefMessages(chat, intent, input);
      close(run, 'chief');
      if (intent?.scenario) this.runNow(intent.scenario);
      const handoff = intent?.handoff;
      if (!handoff || !intent.answer) return;
      // the agent who owns it answers its part — its own turn on the conversation
      const answer = intent.answer;
      const turn: Run = { id: `run-${hex()}`, thread_id: tid, status: 'running', kind: 'handoff', input, error: null, interrupts: null, created: this.now(), started: this.now(), ended: null, source: 'web', superseded_by: null };
      this.companyRuns.unshift(turn);
      this.setWorking(handoff, { thread_id: tid, run_id: turn.id, title: chat.title });
      this.emit({ event: 'run.created', run_id: turn.id, thread_id: tid });
      this.emit({ event: 'run.started', run_id: turn.id, thread_id: tid });
      this.stream(turn, tid, handoff, answer, this.pace.chatMs, () => {
        chat.messages.push(this.agentMessage(handoff, answer));
        chat.active_agent = handoff;
        close(turn, handoff);
      });
    });
    return { run_id: run.id };
  }

  // ------------------------------------------------------------------ read models

  me(): Me {
    const owner = this.data.users.find((u) => u.id === OWNER_ID) ?? this.data.users[0];
    return {
      user: { ...owner, username: this.account.demoId.toLowerCase(), display: this.account.demoId, locale: this.locale, title: this.data.owner_title, two_factor: false },
      stage: 'full',
      csrf: 'demo',
      local: false,
      locale: this.locale,
      relogin: false,
      scopes: [
        {
          org: this.data.org.id,
          display: this.data.org.display,
          role: 'owner',
          whole_org: true,
          workspaces: [{ name: this.data.org.ws, display: this.data.org.ws_display, role: 'owner', running: true }],
        },
      ],
      last_scope: { org: this.data.org.id, workspace: this.data.org.ws },
    };
  }

  private users(): PublicUser[] {
    const me = this.me().user!;
    return this.data.users.map((u) => (u.id === OWNER_ID ? me : u));
  }

  private people(): OrgPerson[] {
    return this.data.people.map((p) => (p.id === OWNER_ID ? { ...p, display: this.account.demoId, username: this.account.demoId.toLowerCase() } : p));
  }

  private orgChart(): OrgChart {
    return { ...this.data.org_chart, owners: this.data.org_chart.owners.map((o) => (o.id === OWNER_ID ? { ...o, display: this.account.demoId } : o)) };
  }

  private company(): Company {
    return { ...this.data.company, name: this.account.companyName };
  }

  /** 여러 법인 (2026-11-14): the demo company is its one entity, the 대표 법인. */
  private entity(): LegalEntity {
    const c = this.company();
    const kind = c.country && c.country !== 'KR' ? 'foreign' : c.kind;
    return {
      id: 1, kind, name: c.name, registration_no: '', registration_kind: null, representative: c.representative,
      country: c.country, address: c.address, controlled_by: c.controlled_by, is_primary: true, complete: c.complete,
      created: 0, updated: 0, businesses: [], connections: [], removable: false, blocked_by: 'primary',
    };
  }

  private agents(): Agent[] {
    return this.data.agents.map((a) => ({ ...a, working_on: this.working.get(a.name) ?? [] }));
  }

  private workflows(): { workflows: WorkflowSummary[]; errors: string[] } {
    return {
      errors: [],
      workflows: this.data.workflows.map((wf) => {
        const last = this.wfRuns.find((r) => this.wfThreads.get(r.thread_id)?.workflow === wf.name);
        return {
          name: wf.name,
          title: wf.title,
          description: wf.description,
          schedule: null,
          team: wf.team,
          inputs: [],
          steps: wf.steps.map((s) => ({ id: s.id, type: s.type, title: s.title })),
          enabled: true,
          last_run: last ? { id: last.id, status: last.status, created: last.created } : null,
        };
      }),
    };
  }

  private approvals(): ApprovalItem[] {
    const out: ApprovalItem[] = [];
    for (const th of this.wfThreads.values()) {
      const run = this.latestWfRun(th.id);
      if (!run || run.status !== 'interrupted') continue;
      const card = run.interrupts?.[0]?.value as ApprovalCard | undefined;
      if (!card) continue;
      out.push({ source: 'workflow', thread_id: th.id, run_id: run.id, created: run.created, card, tier: this.tier(card.category), can_approve: true });
    }
    return out.sort((a, b) => b.created - a.created);
  }

  private workArtifacts(th: WfThread) {
    return th.artifacts
      .map((id) => this.artifacts.find((a) => a.id === id))
      .filter((a): a is Artifact => !!a)
      .reverse()
      .map((a) => ({ id: a.id, kind: a.kind, title: a.title, needs_review: a.needs_review }));
  }

  private work(): WorkEntry[] {
    const items: WorkEntry[] = [];
    for (const th of this.wfThreads.values()) {
      const wf = this.def(th.workflow)!;
      const run = this.latestWfRun(th.id)!;
      const first = this.wfRuns.filter((r) => r.thread_id === th.id).at(-1)!;
      items.push({
        source: 'workflow',
        thread_id: th.id,
        run_id: run.id,
        title: th.title,
        workflow: th.workflow,
        cron: null,
        status: run.status,
        created: first.created,
        ended: th.status === 'done' ? run.ended : null,
        agents: ['chief', ...th.agents.filter((a) => a !== 'chief')].slice(0, 4),
        step: th.step,
        steps: wf.steps.length,
        current_step: wf.steps[th.step]?.title ?? null,
        artifacts: this.workArtifacts(th),
      });
    }
    for (const chat of this.chats.values()) {
      const run = this.companyRuns.find((r) => r.thread_id === chat.id);
      if (!run) continue;
      const agents = [...new Set(chat.messages.filter((m) => m.role === 'assistant' && m.name).map((m) => m.name!))];
      items.push({ source: 'chat', thread_id: chat.id, run_id: run.id, title: chat.title, workflow: null, cron: null, status: run.status, created: chat.created, ended: run.ended, agents, step: null, steps: null, current_step: null, artifacts: [] });
    }
    return items.sort((a, b) => b.created - a.created);
  }

  private digest(): Digest {
    const until = this.now();
    const since = this.digestSince;
    const finished: DigestWork[] = this.work()
      .filter((w) => w.status === 'success' && (w.ended ?? 0) > since && (w.ended ?? 0) <= until)
      .map((w) => ({ org: this.data.org.id, workspace: this.data.org.ws, source: w.source, thread_id: w.thread_id, run_id: w.run_id, title: w.title, workflow: w.workflow, cron: null, status: w.status, ended: w.ended ?? until, agents: w.agents, artifacts: w.artifacts, error: null }));
    const mine = this.digestBasis === 'acknowledged' ? [] : this.approvals().map((a) => ({ ...a, org: this.data.org.id, workspace: this.data.org.ws }));
    const decided = this.decisions.filter((d) => d.ts > since && d.ts <= until);
    return {
      basis: this.digestBasis,
      since,
      until,
      finished,
      failed: [],
      approvals_mine: mine,
      approvals_others: [],
      decided,
      scheduled: [],
      calendar: [],
      cost: { spent_usd: 0, orgs: [{ org: this.data.org.id, display: this.data.org.display, spent_usd: 0 }] },
      counts: { finished: finished.length, failed: 0, approvals_mine: mine.length, approvals_others: 0, decided: decided.length, scheduled: 0, calendar: 0 },
      cap: 20,
    };
  }

  private calendarList(q: URLSearchParams): CalendarList {
    const from = q.get('from') ?? '0000';
    const to = q.get('to') ?? '9999';
    const kind = q.get('kind');
    const org = q.get('org');
    const day = (s: string | null) => (s ?? '').slice(0, 10);
    const items = this.calendar.items.filter((it) => {
      if (kind && it.kind !== kind) return false;
      if (org && it.org !== org) return false;
      if (!it.start) return q.get('undated') === 'true';
      return day(it.start) <= to && day(it.end ?? it.start) >= from;
    });
    const ids = new Set(items.map((i) => i.id));
    const todos: CalendarTodo[] = [];
    for (const id of ids) todos.push(...(this.calendar.details[id]?.todos ?? []));
    const context = this.calendar.items.filter((it) => !ids.has(it.id) && items.some((c) => c.parent_id === it.id));
    return { start: from, end: to, items, todos, context };
  }

  private calendarDetail(id: string): CalendarDetail | null {
    const d = this.calendar.details[id];
    if (!d) return null;
    const item = this.calendar.items.find((i) => i.id === id) ?? d.item;
    return { ...d, item, children: this.calendar.items.filter((i) => i.parent_id === id) };
  }

  private patchItem(id: string, body: Record<string, unknown>): CalendarItem | null {
    const i = this.calendar.items.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const allowed = ['title', 'notes', 'start', 'end', 'all_day', 'status', 'category_id', 'tag_ids'] as const;
    const next = { ...this.calendar.items[i], updated: this.now() } as CalendarItem & Record<string, unknown>;
    for (const k of allowed) if (k in body) (next as Record<string, unknown>)[k] = body[k];
    this.calendar.items[i] = next;
    if (this.calendar.details[id]) this.calendar.details[id] = { ...this.calendar.details[id], item: next };
    return next;
  }

  private addItem(body: Record<string, unknown>): CalendarItem {
    const at = this.now();
    const item: CalendarItem = {
      id: `ci-${hex()}`,
      kind: body.kind === 'personal' ? 'personal' : 'work',
      org: body.kind === 'personal' ? null : (typeof body.org === 'string' ? body.org : this.data.org.id),
      workspace: null,
      owner_id: body.kind === 'personal' ? OWNER_ID : null,
      parent_id: typeof body.parent_id === 'string' ? body.parent_id : null,
      title: String(body.title ?? '').slice(0, 200),
      notes: String(body.notes ?? ''),
      start: typeof body.start === 'string' ? body.start : null,
      end: typeof body.end === 'string' ? body.end : typeof body.start === 'string' ? body.start : null,
      all_day: body.all_day !== false,
      category_id: typeof body.category_id === 'string' ? body.category_id : null,
      tag_ids: Array.isArray(body.tag_ids) ? (body.tag_ids as string[]) : [],
      status: 'planned',
      position: this.calendar.items.length,
      created_by: OWNER_ID,
      created: at,
      updated: at,
    };
    this.calendar.items.push(item);
    this.calendar.details[item.id] = { item, parent: null, children: [], todos: [], child_todos: [] };
    return item;
  }

  private todoOut(todoId: string, body: Record<string, unknown> | null, itemId?: string): { todo: CalendarTodo; item: CalendarItem } | null {
    if (itemId) {
      const d = this.calendar.details[itemId];
      if (!d) return null;
      const at = this.now();
      const todo: CalendarTodo = { id: `ct-${hex()}`, item_id: itemId, title: String(body?.title ?? '').slice(0, 200), done: false, due: null, assignee_id: null, position: d.todos.length, created: at, updated: at };
      d.todos = [...d.todos, todo];
      return { todo, item: this.calendarDetail(itemId)!.item };
    }
    for (const [iid, d] of Object.entries(this.calendar.details)) {
      const at = d.todos.findIndex((x) => x.id === todoId);
      if (at < 0) continue;
      const next = { ...d.todos[at], ...(body && 'done' in body ? { done: !!body.done } : {}), ...(body && typeof body.title === 'string' ? { title: body.title } : {}), updated: this.now() };
      d.todos = d.todos.map((x, i) => (i === at ? next : x));
      return { todo: next, item: this.calendarDetail(iid)!.item };
    }
    return null;
  }

  // ------------------------------------------------------------------ the API

  /** One request, answered as the engine would — `path` without `/api`, `query` as sent. */
  handle(method: string, path: string, query: URLSearchParams, body: unknown): Answer {
    const b = (body ?? {}) as Record<string, unknown>;
    const { id: org, ws } = this.data.org;
    const O = `/o/${org}`;
    const W = `${O}/w/${ws}`;
    const GET = method === 'GET';
    const m = (re: RegExp) => re.exec(path);
    let hit: RegExpExecArray | null;

    // the account
    if (path === '/me' && GET) return ok(this.me());
    if (path === '/me' && method === 'PATCH') {
      if (typeof b.locale === 'string' && Object.keys(b).length === 1) {
        if (b.locale === 'ko' || b.locale === 'en' || b.locale === 'zh-CN') this.locale = b.locale;
        return ok(this.me());
      }
      return err(403, 'forbidden');
    }
    if (path === '/health' && GET) return ok({ ok: true, passkeys: false });
    if (path === '/server' && GET) return ok(this.data.server);
    if (path === '/company' && GET) return ok(this.company());
    if (path === '/entities' && GET) return ok({ entities: [this.entity()] });
    if (path === '/snapshot' && GET) return ok(this.data.snapshot);
    if (path === '/users' && GET) return ok(this.users());
    if (path === '/access' && GET) return ok(this.data.access);
    if (path === '/me/passkeys' && GET) return ok([]);
    if (path === '/me/digest' && GET) return ok(this.digest());
    if (path === '/me/digest/ack' && method === 'POST') {
      this.digestSince = typeof b.until === 'number' ? b.until : this.now();
      this.digestBasis = 'acknowledged';
      return ok({ seen_until: this.digestSince, basis: 'acknowledged' });
    }
    if (path === '/auth/logout' && method === 'POST') return ok({ ok: true });

    // the calendar
    if (path === '/calendar/items' && GET) return ok(this.calendarList(query));
    if (path === '/calendar/items' && method === 'POST') return ok(this.addItem(b));
    if (path === '/calendar/labels' && GET) return ok(this.data.calendar.labels);
    if (path === '/calendar/agent-access' && GET) return ok(this.data.calendar.agent_access);
    if (path === '/calendar/agent-view' && GET) return ok({ user_id: OWNER_ID, level: 'off', start: query.get('from') ?? '', end: query.get('to') ?? '', entries: [] });
    if ((hit = m(/^\/calendar\/items\/([^/]+)$/))) {
      if (GET) {
        const d = this.calendarDetail(hit[1]);
        return d ? ok(d) : err(404, 'not_found');
      }
      if (method === 'PATCH') {
        const it = this.patchItem(hit[1], b);
        return it ? ok(it) : err(404, 'not_found');
      }
    }
    if ((hit = m(/^\/calendar\/items\/([^/]+)\/todos$/)) && method === 'POST') {
      const out = this.todoOut('', b, hit[1]);
      return out ? ok(out) : err(404, 'not_found');
    }
    if ((hit = m(/^\/calendar\/todos\/([^/]+)$/)) && method === 'PATCH') {
      const out = this.todoOut(hit[1], b);
      return out ? ok(out) : err(404, 'not_found');
    }

    // the org
    if (path === `${O}/teams` && GET) return ok(this.data.teams);
    if (path === `${O}/org-chart` && GET) return ok(this.orgChart());
    if (path === `${O}/people` && GET) return ok(this.people());
    if (path === `${O}/approval-policy` && GET) return ok(this.data.approval_policy);
    if (path === `${O}/connections` && GET) return ok([]);
    if (path === `${O}/entity` && GET) return ok({ entity_id: 1, explicit: false });
    if (path === `${O}/workflows` && GET) return ok(this.workflows());
    if ((hit = m(new RegExp(`^${O}/screens/([a-z-]+)$`))) && GET) return ok(this.data.screens[hit[1] === 'home' ? 'dashboard' : hit[1]] ?? this.data.screens.dashboard);

    // the workspace
    if (path === `${W}/threads` && GET) {
      const all = [...this.chats.values(), ...this.agentThreads.values()].map(({ id, title, metadata, created, updated }) => ({ id, title, metadata, created, updated }));
      return ok(all.sort((a, z) => z.updated - a.updated));
    }
    if (path === `${W}/threads` && method === 'POST') return ok({ thread_id: this.newThread(typeof b.title === 'string' ? b.title : null) });
    if ((hit = m(new RegExp(`^${W}/threads/([^/]+)/state$`))) && GET) {
      const t = this.chats.get(hit[1]) ?? this.agentThreads.get(hit[1]);
      if (!t) return err(404, 'not_found');
      return ok({ values: { messages: t.messages, active_agent: t.active_agent, grants: [], pending_approval: null }, next: [], interrupts: [] });
    }
    if ((hit = m(new RegExp(`^${W}/threads/([^/]+)/runs$`))) && method === 'POST') {
      const r = this.say(hit[1], String(b.input ?? ''));
      return r ? ok(r) : err(404, 'not_found');
    }
    if (path === `${W}/runs` && GET) {
      let runs = this.companyRuns;
      const status = query.get('status');
      const thread = query.get('thread_id');
      if (status) runs = runs.filter((r) => r.status === status);
      if (thread) runs = runs.filter((r) => r.thread_id === thread);
      return ok(runs.slice(0, Number(query.get('limit') ?? 50)));
    }
    if (path === `${W}/agents` && GET) return ok(this.agents());
    if (path === `${W}/approvals` && GET) return ok(this.approvals());
    if (path === `${W}/budget` && GET) return ok(this.data.budget);
    if (path === `${W}/workflows` && GET) return ok(this.workflows());
    if (path === `${W}/schedules` && GET) return ok(this.data.schedules);
    if (path === `${W}/uploads` && GET) return ok([]);
    if (path === `${W}/access` && GET) return ok(this.data.ws_access);
    if (path === `${W}/work` && GET) return ok({ items: this.work().slice(0, Number(query.get('limit') ?? 50)) });
    if (path === `${W}/workflow-runs` && GET) {
      const name = query.get('workflow');
      const runs = name ? this.wfRuns.filter((r) => this.wfThreads.get(r.thread_id)?.workflow === name) : this.wfRuns;
      return ok(runs.slice(0, Number(query.get('limit') ?? 20)));
    }
    if ((hit = m(new RegExp(`^${W}/workflows/([^/]+)/run$`))) && method === 'POST') {
      const r = this.runNow(hit[1]);
      if (r) this.onAction(`run:${hit[1]}`);
      return r ? ok(r) : err(404, 'not_found');
    }
    if ((hit = m(new RegExp(`^${W}/workflow-threads/([^/]+)/state$`))) && GET) {
      const th = this.wfThreads.get(hit[1]);
      if (!th) return err(404, 'not_found');
      const wf = this.def(th.workflow)!;
      return ok({
        values: { workflow: th.workflow, inputs: {}, step: th.step, current_step: wf.steps[th.step]?.id ?? null, outputs: th.outputs, artifacts: th.artifacts, status: th.status },
        next: th.status === 'done' ? [] : ['step'],
        interrupts: th.interrupts,
      });
    }
    if ((hit = m(new RegExp(`^${W}/workflow-threads/([^/]+)/resume$`))) && method === 'POST') {
      const th = this.wfThreads.get(hit[1]);
      const step = th ? this.def(th.workflow)?.steps[th.step]?.id : undefined;
      const r = this.resume(hit[1], String(b.value ?? ''));
      if (r) this.onAction(`${b.value === 'declined' ? 'decline' : 'approve'}:${step ?? '-'}`);
      return r ? ok(r) : err(409, 'conflict');
    }
    if (path === `${W}/artifacts` && GET) {
      let list = this.artifacts;
      const kind = query.get('kind');
      if (kind) list = list.filter((a) => a.kind === kind);
      if (query.get('needs_review') === 'true') list = list.filter((a) => a.needs_review);
      return ok(list.slice(0, Number(query.get('limit') ?? 50)));
    }
    if ((hit = m(new RegExp(`^${W}/artifacts/([^/]+)$`))) && GET) {
      const a = this.artifacts.find((x) => x.id === hit![1]);
      return a ? ok(a) : err(404, 'not_found');
    }
    if ((hit = m(new RegExp(`^${W}/artifacts/([^/]+)/review$`))) && method === 'POST') {
      const a = this.artifacts.find((x) => x.id === hit![1]);
      if (!a) return err(404, 'not_found');
      a.needs_review = false;
      a.reviewed_by = OWNER_ID;
      this.onAction(`review:${a.kind}`);
      return ok(a);
    }

    // everything else that would change something takes nothing here
    if (!GET) return err(403, 'forbidden');
    return err(404, 'not_found');
  }

  /** The days the demo account has left — for the band; null when it has no end. */
  daysLeft(): number | null {
    if (this.account.expires === null) return null;
    return Math.max(0, Math.ceil((this.account.expires - this.now()) / DAY));
  }
}
