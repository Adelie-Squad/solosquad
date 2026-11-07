// Names people read for orgs, workspaces and teams (DESIGN.md `## 문구` — 이름 표기).
// The engine sends `display` (org.yaml / workspace.yaml `display_name`, else the id). An id
// is a lowercase slug (`spacex`, `launch-ops`); when no display name was set it is made
// readable here: `-` and `_` become spaces, each word starts with a capital. The bundled
// teams are translated (`team.<id>`).
import type { ScopeOrg } from '../api/types.gen';
import type { Translate } from '../i18n';
import type { MessageKey } from '../i18n/ko';

/** `launch-ops` → `Launch Ops`, `spacex` → `Spacex`. Words already capitalised stay as they are. */
export function readable(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toLocaleUpperCase('en') + w.slice(1))
    .join(' ');
}

/** The display name when one was set, else the id made readable. */
export function shownName(id: string, display?: string | null): string {
  const d = display?.trim();
  return d && d !== id ? d : readable(id);
}

export function orgName(scopes: ScopeOrg[], org: string): string {
  return shownName(org, scopes.find((o) => o.org === org)?.display);
}

export function workspaceName(scopes: ScopeOrg[], org: string, ws: string): string {
  const found = scopes.find((o) => o.org === org)?.workspaces.find((w) => w.name === ws);
  return shownName(ws, found?.display);
}

/** The bundled teams' names in each language. The ids stay as they are in data; a team a
 * customer added shows its id made readable. */
const TEAM_KEYS: Partial<Record<string, MessageKey>> = {
  core: 'team.core',
  product: 'team.product',
  engineering: 'team.engineering',
  business: 'team.business',
  brand: 'team.brand',
};

export function teamName(id: string, t: Translate): string {
  const key = Object.prototype.hasOwnProperty.call(TEAM_KEYS, id) ? TEAM_KEYS[id] : undefined;
  return key ? t(key) : readable(id);
}
