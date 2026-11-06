import type { MessageKey } from '../i18n';
import { ICON, type LucideIcon } from '../icons';

export interface NavItem {
  /** Path inside the scope — a workspace screen, or (`org: true`) an org screen. */
  to: string;
  org?: boolean;
  icon: LucideIcon;
  label: MessageKey;
  ownerOnly?: boolean;
}

/** The fixed menu. Items a role cannot use are not shown (the server still enforces, I25).
 * Connections and logging out live in Settings (rarely used, decided 2026-11-06). */
export const NAV: NavItem[] = [
  { to: '', icon: ICON.home, label: 'nav.home' },
  { to: '/office', icon: ICON.office, label: 'nav.office' },
  { to: '/approvals', icon: ICON.approvals, label: 'nav.approvals' },
  { to: '/workflows', icon: ICON.workflows, label: 'nav.workflows' },
  { to: '/screens/artifacts', icon: ICON.artifacts, label: 'nav.artifacts' },
  { to: '/org', org: true, icon: ICON.org, label: 'nav.org' },
  { to: '/budget', icon: ICON.budget, label: 'nav.budget' },
];

export const visibleNav = (isOwner: boolean) => NAV.filter((n) => isOwner || !n.ownerOnly);

/** The address of a menu item in the current scope. */
export const navHref = (n: NavItem, links: { w: (p?: string) => string; o: (p?: string) => string }) => (n.org ? links.o(n.to) : links.w(n.to));
