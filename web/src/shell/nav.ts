import type { MessageKey } from '../i18n';
import { ICON, type LucideIcon } from '../icons';

export interface NavItem {
  /** An account address (`account: true`, e.g. `/calendar`), else a path inside the workspace in
   * the switcher (or, with `org: true`, inside its org). */
  to: string;
  account?: boolean;
  org?: boolean;
  icon: LucideIcon;
  label: MessageKey;
  ownerOnly?: boolean;
  /** Other paths that belong to this item (the tile stays selected on them). */
  also?: string[];
}

/** The menu of decision 60 (2026-11-09): two groups of tiles in two columns.
 *
 * - the whole account (company) — dashboard · calendar · messenger, filtered inside by business
 *   and workspace (`/dashboard` · `/calendar` · `/messenger`);
 * - the workspace in the switcher — office · Tasks · workflows (`/o/<org>/w/<ws>/…`).
 *
 * Three tiles each: the first takes a whole row, so neither grid has a hole. Items a role cannot
 * use are not shown (the server still enforces, I25). Connections and logging out live in
 * Settings; the org chart is part of the office; the scheduled runs are a view of workflows. */
export const ACCOUNT_NAV: NavItem[] = [
  { to: '/dashboard', account: true, icon: ICON.dashboard, label: 'nav.dashboard' },
  { to: '/calendar', account: true, icon: ICON.calendar, label: 'nav.calendar' },
  { to: '/messenger', account: true, icon: ICON.messenger, label: 'nav.messenger' },
];

export const WORKSPACE_NAV: NavItem[] = [
  { to: '/office', icon: ICON.office, label: 'nav.office' },
  { to: '/tasks', icon: ICON.tasks, label: 'nav.tasks' },
  { to: '/workflows', icon: ICON.workflows, label: 'nav.workflows', also: ['/scheduled-jobs'] },
];

export const NAV: NavItem[] = [...ACCOUNT_NAV, ...WORKSPACE_NAV];

export const visibleNav = (isOwner: boolean, items: NavItem[] = NAV) => items.filter((n) => isOwner || !n.ownerOnly);

type Links = { w: (p?: string) => string; o: (p?: string) => string };

/** The address of a menu item: an account address as it is, else inside the switcher's scope. */
export const navHref = (n: NavItem, links: Links) => (n.account ? n.to : n.org ? links.o(n.to) : links.w(n.to));

/** Is this item the screen on show? Its own address or one of `also`, and anything below them. */
export function navActive(n: NavItem, pathname: string, links: Links): boolean {
  const roots = [n.to, ...(n.also ?? [])].map((p) => (n.account ? p : n.org ? links.o(p) : links.w(p)));
  return roots.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}
