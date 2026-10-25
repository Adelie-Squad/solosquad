import type { ReactNode } from 'react';
import { categoryById, type CategoryId } from '../data/dummy';
import { useWorkspace } from '../workspace-context';

/** 라우트 가드 — 해당 카테고리 권한이 없으면 화면 대신 안내를 보인다 */
export function RequireCategory({ category, children }: { category: CategoryId; children: ReactNode }) {
  const { canAccess } = useWorkspace();
  return canAccess(category) ? children : <NoAccess category={category} />;
}

/** 팀원이 권한 없는 화면에 들어왔을 때 */
export function NoAccess({ category }: { category: CategoryId }) {
  const c = categoryById[category];
  return (
    <div className="view">
      <div className="panel empty no-access">
        <p className="no-access-icon">🔒</p>
        <p>
          <strong>
            {c.icon} {c.label}
          </strong>{' '}
          권한이 없어요. 사장님께 권한을 요청해 주세요.
        </p>
      </div>
    </div>
  );
}
