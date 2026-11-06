import { orgName } from '../lib/names';
import { useScope } from '../scope';
import { useSession } from '../session';

/** The org an org-wide screen (org chart · connections · settings) is about — one quiet line
 * over the title, in the same readable name as the switch menu. */
export function ScopeEyebrow() {
  const { me } = useSession();
  const scope = useScope();
  return <p className="view-eyebrow">{orgName(me.scopes, scope.org)}</p>;
}
