import type { MessageKey } from '../i18n';
import { ICON, type LucideIcon } from '../icons';

export interface NavItem {
  /** Path inside the scope — a workspace screen, or (`org: true`) an org screen. */
  to: string;
  org?: boolean;
  icon: LucideIcon;
  label: MessageKey;
  ownerOnly?: boolean;
  /** Other paths that belong to this item (the tile stays selected on them). */
  also?: string[];
}

/** The fixed menu (2026-11-07): dashboard · office · messenger · Task · workflows. Five tiles in two
 * columns — the first takes a whole row, so the grid has no hole. Items a role cannot use are not
 * shown (the server still enforces, I25). Connections and logging out live in Settings; the org
 * chart is part of the office; the schedule is a view of the workflows. */
export const NAV: NavItem[] = [
  { to: '/dashboard', icon: ICON.dashboard, label: 'nav.dashboard' },
  { to: '/office', icon: ICON.office, label: 'nav.office' },
  { to: '/messenger', icon: ICON.messenger, label: 'nav.messenger' },
  { to: '/tasks', icon: ICON.tasks, label: 'nav.tasks' },
  { to: '/workflows', icon: ICON.workflows, label: 'nav.workflows', also: ['/schedule'] },
];

export const visibleNav = (isOwner: boolean) => NAV.filter((n) => isOwner || !n.ownerOnly);

/** The address of a menu item in the current scope. */
export const navHref = (n: NavItem, links: { w: (p?: string) => string; o: (p?: string) => string }) => (n.org ? links.o(n.to) : links.w(n.to));

/** Is this item the screen on show? Its own address or one of `also`, and anything below them. */
export function navActive(n: NavItem, pathname: string, links: { w: (p?: string) => string; o: (p?: string) => string }): boolean {
  const roots = [n.to, ...(n.also ?? [])].map((p) => (n.org ? links.o(p) : links.w(p)));
  return roots.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}
