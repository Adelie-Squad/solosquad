import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { CommandBar } from '../components/CommandBar';
import { Sidebar } from '../components/Sidebar';
import { spaces } from '../data/dummy';
import { useLiveActivity } from '../hooks/useLiveActivity';
import type { WorkspaceContext } from '../workspace-context';
import './Workspace.css';

/**
 * 서비스 페이지 셸 — Arc 브라우저 레이아웃.
 * 스페이스 색 그라디언트가 창 전체를 덮고, 왼쪽에 투명한 사이드바(LNB),
 * 오른쪽에 둥근 흰 카드 하나로 콘텐츠가 떠 있다.
 */
export function Workspace() {
  const [spaceId, setSpaceId] = useState(spaces[0].id);
  const [commandOpen, setCommandOpen] = useState(false);
  const jobs = useLiveActivity();
  const space = spaces.find((s) => s.id === spaceId) ?? spaces[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const context: WorkspaceContext = { jobs, space };

  return (
    <div
      className="workspace"
      style={{ background: space.gradient, ['--accent' as string]: space.accent }}
    >
      <Sidebar
        jobs={jobs}
        space={space}
        onSpaceChange={setSpaceId}
        onOpenCommand={() => setCommandOpen(true)}
      />
      <main className="workspace-card">
        <Outlet context={context} />
      </main>
      {commandOpen && <CommandBar onClose={() => setCommandOpen(false)} />}
    </div>
  );
}
