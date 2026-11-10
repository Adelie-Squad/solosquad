// The org chart's connector lines (DESIGN.md `### 조직도` — 연결선, user 2026-11-10): 대표 → 임원 →
// a bus per row of team columns → a drop onto each team's dot, and inside a team a spine with a tick
// to each member. Columns wrap into balanced rows, each with its own bus; a narrow chart (a phone)
// is one indented column with a spine down the left. Lines are decorative; the lists stay as they were.
import { cleanup, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Agent, OrgChart as OrgChartData } from '../src/api/types.gen';
import { OrgChart } from '../src/components/OrgChart';
import { columnsFor, orgLines, roundedPath, rowsOf, type Box, type OrgBox, type OrgGeometry } from '../src/components/orgGeometry';
import { I18nProvider } from '../src/i18n';
import { LandingOrgChart } from '../src/landing/LandingOrgChart';
import { renderWith } from './helpers';

const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
const design = read('src/styles/design.css');
const landingCss = read('src/styles/landing.css');
const rule = (css: string, selector: string) => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `no rule ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at));
};

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });
/** A team column at (x, y): its dot 8px square at the column's top-left. */
const dept = (x: number, y: number, w = 200, h = 300): OrgBox => ({ box: box(x, y, w, h), pin: box(x, y + 5, 8, 8) });
const node = (x: number, y: number, w = 220, h = 44): OrgBox => ({ box: box(x, y, w, h), pin: box(x + 5, y + 8, 28, 28) });

/** Four teams laid out `cols` to a row, as the grid puts them (200 wide, 20 apart, rows 340 apart). */
function grid(cols: number, n = 4): OrgBox[] {
  return Array.from({ length: n }, (_, i) => dept((i % cols) * 220, 140 + Math.floor(i / cols) * 340));
}

const geometry = (mode: OrgGeometry['mode'], depts: OrgBox[]): OrgGeometry => ({
  mode,
  owners: [node(330, 0)],
  chief: node(330, 68),
  depts,
});
const kinds = (g: OrgGeometry) => orgLines(g).map((l) => l.kind);
const count = (g: OrgGeometry, kind: string) => kinds(g).filter((k) => k === kind).length;

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

describe('connector lines: geometry', () => {
  it('one bus per row of team columns — whatever the wrap', () => {
    expect(rowsOf(grid(4))).toHaveLength(1);
    expect(count(geometry('columns', grid(4)), 'bus')).toBe(1);
    expect(rowsOf(grid(2))).toHaveLength(2);
    expect(count(geometry('columns', grid(2)), 'bus')).toBe(2);
    expect(count(geometry('columns', grid(3, 5)), 'bus')).toBe(2);
    expect(count(geometry('columns', grid(1)), 'bus')).toBe(4); // a lone column per row: a straight bus each
  });

  it('a drop onto every team’s dot, the outer two as the bus’s own turns', () => {
    const lines = orgLines(geometry('columns', grid(4)));
    const bus = lines.find((l) => l.kind === 'bus')!.d;
    // starts at the first dot's top (x 4.5 — the dot's centre on a whole pixel), up to the bus, across, down to the last dot
    expect(bus.startsWith('M4.5 145.5')).toBe(true);
    expect(bus.endsWith('L664.5 145.5')).toBe(true);
    expect(bus).toContain('Q'); // 4px rounded turns, not square
    expect(lines.filter((l) => l.kind === 'drop')).toHaveLength(2); // the two middle teams
  });

  it('runs 대표 → 임원 → the bus → the teams, top to bottom', () => {
    const lines = orgLines(geometry('columns', grid(4)));
    expect(lines.map((l) => l.kind)).toEqual(['trunk', 'bus', 'drop', 'drop', 'trunk']);
    const ys = (d: string) => [...d.matchAll(/[MLQ](-?[\d.]+) (-?[\d.]+)/g)].map((m) => +m[2]);
    const [ownerToChief, bus] = lines;
    expect(ys(ownerToChief.d)).toEqual([44.5, 68.5]); // owner's bottom to Chief's top
    const busY = 133.5; // a 12px drop over the dots (145), under Chief (bottom 112)
    expect(ys(bus.d)).toContain(busY);
    expect(Math.min(...ys(bus.d))).toBeGreaterThan(112);
    const chiefDown = lines[lines.length - 1];
    expect(ys(chiefDown.d)).toEqual([112.5, busY]);
  });

  it('a second row hangs from the first row’s bus through the column gap', () => {
    const lines = orgLines(geometry('columns', grid(2)));
    const trunks = lines.filter((l) => l.kind === 'trunk' || l.kind === 'bus').map((l) => l.d);
    // the gap between column 1 (0–200) and column 2 (220–420) is at x 210
    expect(trunks.some((d) => /M210\.5 \d/.test(d) || / L210\.5 /.test(d))).toBe(true);
  });

  it('the tree: a spine down from Chief’s icon with a tick into each team, no bus', () => {
    const depts = [0, 1, 2, 3].map((i) => dept(32, 140 + i * 200, 300, 180));
    const g = geometry('tree', depts);
    expect(count(g, 'bus')).toBe(0);
    expect(count(g, 'branch')).toBe(4);
    const lines = orgLines(g);
    const spine = lines.filter((l) => l.kind === 'trunk').map((l) => l.d);
    expect(spine.at(-1)!.startsWith('M349.5 112.5')).toBe(true); // Chief's icon centre (330 + 5 + 14), from its bottom
    expect(lines.filter((l) => l.kind === 'branch').every((l) => l.d.endsWith(`L32.5 ${l.d.split(' ').at(-1)}`))).toBe(true); // each tick ends on a dot
  });

  it('rounds turns with a 4px radius and keeps straight lines straight', () => {
    expect(roundedPath([[0, 0], [0, 10]])).toBe('M0.5 0.5 L0.5 10.5');
    expect(roundedPath([[0, 0], [0, 10], [10, 10]])).toBe('M0.5 0.5 L0.5 6.5 Q0.5 10.5 4.5 10.5 L10.5 10.5');
  });

  it('balances the columns over the rows they take', () => {
    expect(columnsFor(1000, 4, 190, 20)).toBe(4);
    expect(columnsFor(780, 4, 190, 20)).toBe(2); // 3 fit, but 3 + 1 is worse than 2 + 2
    expect(columnsFor(780, 5, 190, 20)).toBe(3); // 3 + 2
    expect(columnsFor(300, 4, 190, 20)).toBe(1);
    expect(columnsFor(460, 4, 150, 12, 2)).toBe(2); // the landing paper: never more than two
  });
});

const agent = (name: string, team: string): Agent => ({
  name,
  description: '',
  display_name: {},
  summary: {},
  team,
  layer: 'package',
  appearance: null,
  working_on: [],
});
const card = (a: Agent) => ({ name: a.name, description: '', display_name: {}, summary: {}, appearance: null });
const AGENTS = [agent('chief', 'core'), agent('product-manager', 'product'), agent('backend-engineer', 'engineering'), agent('sales', 'business'), agent('marketer', 'brand')];
const CHART: OrgChartData = {
  owners: [{ id: 'u-1', display: 'Elon', title: '', role: 'owner' }],
  teams: [
    { name: 'core', agents: [card(AGENTS[0])], people: [] },
    ...AGENTS.slice(1).map((a) => ({ name: a.team!, agents: [card(a)], people: [] })),
  ],
  unassigned: [],
};

/** The chart's width as the layout reads it (jsdom has no layout). */
const atWidth = (w: number) => Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w });

describe('connector lines: the office org chart', () => {
  it('draws the lines as one decorative SVG and keeps the nested lists', () => {
    atWidth(1000);
    renderWith(<OrgChart chart={CHART} agents={AGENTS} statuses={{}} onAgent={() => {}} onPerson={() => {}} />, 'en');
    const chart = screen.getByTestId('orgchart');
    const svg = chart.querySelector('svg.org-lines')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('path[data-line="trunk"]').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('path[data-line="bus"]')).toHaveLength(1);
    expect(chart.getAttribute('data-layout')).toBe('columns');
    expect(chart.style.getPropertyValue('--org-cols')).toBe('4');
    // order: owner, Chief, then the teams — in the DOM and so for a screen reader
    expect([...chart.querySelectorAll('[data-org]')].map((n) => n.getAttribute('data-org'))).toEqual(['owner', 'chief', 'dept', 'dept', 'dept', 'dept']);
    expect(within(screen.getByRole('list', { name: 'Owner and Chief' })).getAllByRole('button')).toHaveLength(2);
    expect(within(screen.getByRole('list', { name: 'Teams' })).getAllByRole('list').map((l) => l.getAttribute('aria-label'))).toEqual(['Product', 'Engineering', 'Business', 'Brand']);
  });

  it('wraps four teams 2 + 2 when three would fit, and is a tree on a phone', () => {
    atWidth(780);
    renderWith(<OrgChart chart={CHART} agents={AGENTS} statuses={{}} onAgent={() => {}} onPerson={() => {}} />, 'en');
    expect(screen.getByTestId('orgchart').style.getPropertyValue('--org-cols')).toBe('2');
    cleanup();
    atWidth(318); // a 390px phone's panel
    renderWith(<OrgChart chart={CHART} agents={AGENTS} statuses={{}} onAgent={() => {}} onPerson={() => {}} />, 'en');
    const chart = screen.getByTestId('orgchart');
    expect(chart.getAttribute('data-layout')).toBe('tree');
    expect(chart.querySelectorAll('svg.org-lines [data-line="bus"]')).toHaveLength(0);
    expect(chart.querySelectorAll('svg.org-lines [data-line="branch"]')).toHaveLength(4);
  });

  it('styles: 1px theme lines, the team spine in CSS, the tree indented; no arrows, shadows or tints', () => {
    const svg = rule(design, '.org-lines');
    expect(svg).toMatch(/stroke: var\(--line-strong\);/);
    expect(svg).toMatch(/stroke-width: 1;/);
    expect(svg).toMatch(/fill: none;/);
    const tick = rule(design, '.orgchart-depts .orgchart-members > li::before');
    expect(tick).toMatch(/border-left: 1px solid var\(--line\);/);
    expect(tick).toMatch(/border-bottom: 1px solid var\(--line\);/);
    expect(rule(design, '.orgchart-depts .orgchart-members > li:last-child::before')).toMatch(/border-bottom-left-radius: 4px;/);
    expect(rule(design, '.orgchart[data-layout="tree"] .orgchart-dept')).toMatch(/padding-left: var\(--org-tree-indent\);/);
    const section = design.slice(design.indexOf('/* ── structure, top to bottom'), design.indexOf('/* ── modal scroll containment'));
    expect(section).not.toMatch(/box-shadow|gradient|marker-end|color-mix/);
  });
});

describe('connector lines: the landing org chart', () => {
  const draw = () => {
    const qc = new QueryClient();
    return render(
      <QueryClientProvider client={qc}>
        <I18nProvider locale="en">
          <MemoryRouter>
            <LandingOrgChart onOpen={() => {}} />
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    );
  };

  it('two columns on the paper (2 + 2, a bus per row), a tree on a phone', () => {
    atWidth(444);
    draw();
    const org = screen.getByTestId('landing-org');
    expect(org.getAttribute('data-layout')).toBe('columns');
    expect(org.style.getPropertyValue('--org-cols')).toBe('2');
    expect(org.querySelector('svg.org-lines')!.getAttribute('aria-hidden')).toBe('true');
    expect([...org.querySelectorAll('[data-org]')].map((n) => n.getAttribute('data-org'))).toEqual(['owner', 'chief', 'dept', 'dept', 'dept', 'dept']);
    cleanup();
    atWidth(334); // the paper on a 390px phone
    draw();
    expect(screen.getByTestId('landing-org').getAttribute('data-layout')).toBe('tree');
    expect(screen.getByTestId('landing-org').querySelectorAll('[data-line="branch"]')).toHaveLength(4);
  });

  it('the lines sit on the paper, so they unroll with it; the team spine is CSS', () => {
    expect(landingCss).toMatch(/\.landing-scroll-sheet \{[^}]*clip-path: inset\(0 -1px calc\(\(1 - var\(--unroll\)\) \* 100%\) -1px\);/);
    expect(rule(landingCss, '.landing-org .org-lines')).toMatch(/stroke: var\(--line-strong\);/);
    expect(rule(landingCss, '.landing-org-members > .landing-org-node::before')).toMatch(/border-left: 1px solid var\(--line\);/);
    expect(rule(landingCss, '.landing-org[data-layout="tree"] .landing-org-teams > li')).toMatch(/padding-left: var\(--org-tree-indent\);/);
  });
});
