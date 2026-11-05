import type { MessageKey } from '../i18n';

export interface NavItem {
  to: string;
  icon: string;
  label: MessageKey;
  ownerOnly?: boolean;
}

/** The fixed menu. Items a role cannot use are not shown (the server still enforces, I25). */
export const NAV: NavItem[] = [
  { to: '/', icon: '🏠', label: 'nav.home' },
  { to: '/office', icon: '🏢', label: 'nav.office' },
  { to: '/approvals', icon: '✅', label: 'nav.approvals' },
  { to: '/workflows', icon: '🧩', label: 'nav.workflows' },
  { to: '/screens/artifacts', icon: '📄', label: 'nav.artifacts' },
  { to: '/org', icon: '👥', label: 'nav.org' },
  { to: '/connections', icon: '🔌', label: 'nav.connections' },
  { to: '/budget', icon: '💳', label: 'nav.budget' },
];

export const visibleNav = (isOwner: boolean) => NAV.filter((n) => isOwner || !n.ownerOnly);
