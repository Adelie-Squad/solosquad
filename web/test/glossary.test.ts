// @vitest-environment node
// One word per concept (DESIGN.md `## 문구` 용어집, 2026-11-08): the locale files must not use a
// word the glossary rules out, and the glossary table must name the words the locales use.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allMessages, dictionaries, type Locale } from '../src/i18n';
import '../src/marketing/messages';

/** Words the glossary rules out, per locale. A lookahead keeps a compound that is allowed. */
const BANNED: Record<Locale, RegExp[]> = {
  ko: [
    /Task/i, /태스크/, // the menu is 과제
    /워크플로(?!우)/, // 워크플로우
    /결과물/, // 산출물
    /결재/, // 승인
    /검수/, // 확인
    /채팅/, /스레드/, // 대화
    /연동/, // 연결
    /사업장/, // 워크스페이스
    /고객사/, // 회사
    /조직(?!도)/, // 사업 (조직도 = the org chart)
    /스케줄/, /크론/, /예약(?!된 작업)/, // 예약된 작업 (일정 = the calendar; checked by key below)
    /직원/, /스태프/, // 팀원
    /사장/, /오너/, // 대표
    /사용액/, // 비용
    /예산/, // 한도
    /부서/, // 팀
    /부탁/, // 요청
  ],
  en: [
    /\bartifacts?\b/i, // work product
    /\bchats?\b/i, /\bthreads?\b/i, // conversation
    /\bintegrations?\b/i, // connection
    /\borgs?\b(?! chart)/i, // business (the org chart keeps its name)
    /\bstaff\b/i, /\bemployees?\b/i, // team member
    /\bboss\b/i, // owner
    /\bspend\b/i, // cost
    /\bbudgets?\b/i, // cap
    /\bdepartments?\b/i, // team
    /\btasks?\b/, // lower-case "task" = a piece of work; "Tasks" is the menu only
    /\bjobs?\b/i, // work
  ],
  'zh-CN': [
    /老板/, /负责人/, // 代表
    /员工/, // 团队成员
    /产出物/, /成果物/, // 工作成果
    /聊天/, /会话/, // 对话
    /对接/, /集成/, // 连接
    /组织(?!架构)/, // 业务 (组织架构 = the org chart)
    /工作空间/, // 工作区
    /预定/, /定时任务/, /计划任务/, // 定时运行 (任务 is the menu word only)
    /用量/, // 费用
    /预算/, // 上限
    /部门/, // 团队
    /等待审批/, // 待审批
    /审核/, // 确认
    /智能体/, // 代理
  ],
};

/** Paths and placeholders are not words — `orgs/<org>/screens/` names a folder. */
const words = (s: string) => s.replace(/\S*\/\S*/g, ' ').replace(/\{\w+\}/g, ' ');

describe('the glossary ban-list (DESIGN.md `## 문구` 용어집)', () => {
  it.each(Object.keys(BANNED) as Locale[])('%s uses no word the glossary rules out', (locale) => {
    const hits: string[] = [];
    for (const [key, text] of Object.entries(allMessages(locale))) {
      for (const re of BANNED[locale]) if (re.test(words(text))) hits.push(`${key}: ${text}  (${re})`);
    }
    expect(hits).toEqual([]);
  });

  // the agent introductions (`summary`) show in the modal and on the landing — same words
  it.each(Object.keys(BANNED) as Locale[])('%s agent summaries use no word the glossary rules out', (locale) => {
    const root = join(process.cwd(), '..', 'agents');
    const files = [join(root, 'main', 'chief', 'SKILL.md'), ...readdirSync(join(root, 'specialists')).map((n) => join(root, 'specialists', n, 'SKILL.md'))];
    const hits: string[] = [];
    for (const f of files) {
      const line = readFileSync(f, 'utf8').match(new RegExp(`^  ${locale}: "(.*)"$`, 'm'));
      if (!line) continue;
      for (const re of BANNED[locale]) if (re.test(words(line[1]))) hits.push(`${f}: ${re}`);
    }
    expect(files.length).toBeGreaterThan(10);
    expect(hits).toEqual([]);
  });

  it('catches a banned word (the list is live)', () => {
    expect(BANNED.ko.some((re) => re.test('Task 에서 처리'))).toBe(true);
    expect(BANNED.ko.some((re) => re.test('워크플로 실행'))).toBe(true);
    expect(BANNED.ko.some((re) => re.test('워크플로우 실행'))).toBe(false);
    expect(BANNED['zh-CN'].some((re) => re.test('只有老板可以'))).toBe(true);
    expect(BANNED['zh-CN'].some((re) => re.test('组织架构'))).toBe(false);
    expect(BANNED.en.some((re) => re.test('Handle in Tasks'))).toBe(false);
    expect(BANNED.en.some((re) => re.test('Give Chief a task'))).toBe(true);
  });
});

// 2026-11-09: 일정 · 日程 are kept for the coming calendar (a person's schedule). The scheduled runs
// are 예약된 작업 · Scheduled runs · 定时运行 — so the word must not come back in their copy.
describe('예약된 작업 is not called 일정', () => {
  const SCHEDULED_KEY = /^(schedule\.|widget\.schedule$|tasks\.scheduled$)/;
  const CALENDAR_WORD: Record<Locale, RegExp> = { ko: /일정/, en: /\bschedules?\b/i, 'zh-CN': /日程/ };
  const NAME: Record<Locale, string> = { ko: '예약된 작업', en: 'Scheduled runs', 'zh-CN': '定时运行' };

  it.each(Object.keys(NAME) as Locale[])('%s: the scheduled-runs copy uses no calendar word', (locale) => {
    const keys = Object.keys(dictionaries[locale]).filter((k) => SCHEDULED_KEY.test(k));
    expect(keys.length).toBeGreaterThan(8);
    const hits = keys.filter((k) => CALENDAR_WORD[locale].test(words(dictionaries[locale][k as keyof (typeof dictionaries)[Locale]])));
    expect(hits).toEqual([]);
  });

  it.each(Object.keys(NAME) as Locale[])('%s: the tab, the empty state and the dashboard widget name it', (locale) => {
    const d = dictionaries[locale];
    expect(d['schedule.tab']).toBe(NAME[locale]);
    expect(d['widget.schedule']).toContain(locale === 'en' ? 'scheduled runs' : NAME[locale]);
    expect(d['schedule.none']).toContain(locale === 'en' ? 'scheduled runs' : NAME[locale]);
  });

  it('the ban list still catches the old words', () => {
    expect(BANNED.ko.some((re) => re.test('스케줄 보기'))).toBe(true);
    expect(BANNED.ko.some((re) => re.test('크론 작업'))).toBe(true);
    expect(BANNED.ko.some((re) => re.test('예약된 작업'))).toBe(false);
    expect(BANNED['zh-CN'].some((re) => re.test('定时任务'))).toBe(true);
    expect(BANNED.en.some((re) => re.test('Scheduled jobs'))).toBe(true);
  });
});

describe('the menu reads the same word everywhere', () => {
  const MENU: Record<Locale, { tasks: string; workflows: string; owner: string }> = {
    ko: { tasks: '과제', workflows: '워크플로우', owner: '대표' },
    en: { tasks: 'Tasks', workflows: 'Workflows', owner: 'Owner' },
    'zh-CN': { tasks: '任务', workflows: '工作流', owner: '代表' },
  };

  it.each(Object.keys(MENU) as Locale[])('%s: menu, screen title, dashboard link and role', (locale) => {
    const d = dictionaries[locale];
    const m = MENU[locale];
    expect(d['nav.tasks']).toBe(m.tasks);
    expect(d['nav.workflows']).toBe(m.workflows);
    expect(d['workflows.title']).toBe(m.workflows);
    expect(d['role.owner']).toBe(m.owner);
    // every place that sends you to the Task screen names it with the menu word
    for (const k of ['widget.todoMore', 'widget.todoRest', 'office.goAnswer'] as const) expect(d[k], `${locale} ${k}`).toContain(m.tasks);
  });
});

describe('DESIGN.md carries the glossary', () => {
  const design = readFileSync(join(process.cwd(), '..', 'DESIGN.md'), 'utf8');
  const start = design.search(/^## 문구$/m);
  const rest = design.slice(start + 3);
  const copy = rest.slice(0, rest.search(/\n## /));
  const rows = copy
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('| ') && !l.startsWith('|---'))
    .map((l) => l.split('|').map((c) => c.trim()));
  const glossary = rows.filter((r) => r.length >= 7 && r[1] !== '개념' && r[1] !== 'id');

  it('has a 용어집 table — concept · ko · en · zh-CN · words not to use', () => {
    expect(copy).toMatch(/\*\*용어집/);
    expect(copy).toMatch(/\|\s*개념\s*\|\s*ko\s*\|\s*en\s*\|\s*zh-CN\s*\|\s*쓰지 않는 말\s*\|/);
    expect(glossary.length).toBeGreaterThanOrEqual(15);
  });

  it.each([
    ['과제', 'Tasks', '任务'],
    ['워크플로우', 'workflow', '工作流'],
    ['대표', 'owner', '代表'],
    ['팀원', 'team member', '团队成员'],
    ['임원', 'Chief', '高管'],
    ['산출물', 'work product', '工作成果'],
    ['대화', 'conversation', '对话'],
    ['예약된 작업', 'scheduled run', '定时运行'],
    ['일정', 'calendar', '日程'],
    ['비용', 'cost', '费用'],
    ['한도', 'cap', '上限'],
  ])('names %s · %s · %s in one row', (ko, en, zh) => {
    const row = glossary.find((r) => r[2].includes(ko) && r[3].includes(en) && r[4].includes(zh));
    expect(row, `${ko} · ${en} · ${zh}`).toBeTruthy();
  });
});
