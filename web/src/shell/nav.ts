import type { MessageKey } from '../i18n';

export interface NavItem {
  /** Path inside the scope — a workspace screen, or (`org: true`) an org screen. */
  to: string;
  org?: boolean;
  icon: string;
  label: MessageKey;
  ownerOnly?: boolean;
}

/** The fixed menu. Items a role cannot use are not shown (the server still enforces, I25). */
export const NAV: NavItem[] = [
  { to: '', icon: '🏠', label: 'nav.home' },
  { to: '/office', icon: '🏢', label: 'nav.office' },
  { to: '/approvals', icon: '✅', label: 'nav.approvals' },
  { to: '/workflows', icon: '🧩', label: 'nav.workflows' },
  { to: '/screens/artifacts', icon: '📄', label: 'nav.artifacts' },
  { to: '/org', org: true, icon: '👥', label: 'nav.org' },
  { to: '/connections', org: true, icon: '🔌', label: 'nav.connections' },
  { to: '/budget', icon: '💳', label: 'nav.budget' },
];

export const visibleNav = (isOwner: boolean) => NAV.filter((n) => isOwner || !n.ownerOnly);

/** The address of a menu item in the current scope. */
export const navHref = (n: NavItem, links: { w: (p?: string) => string; o: (p?: string) => string }) => (n.org ? links.o(n.to) : links.w(n.to));
