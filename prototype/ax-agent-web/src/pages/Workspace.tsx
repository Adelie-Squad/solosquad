import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { CommandBar } from '../components/CommandBar';
import { SettingsDialog } from '../components/SettingsDialog';
import { Sidebar } from '../components/Sidebar';
import { defaultSettings, extraSpaces, spaces as initialSpaces } from '../data/dummy';
import { useLiveActivity } from '../hooks/useLiveActivity';
import type { WorkspaceContext } from '../workspace-context';
import './Workspace.css';

/**
 * 서비스 페이지 셸 — Arc 브라우저 레이아웃.
 * 스페이스 색 그라디언트가 창 전체를 덮고, 왼쪽에 투명한 사이드바(LNB),
 * 오른쪽에 둥근 흰 카드 하나로 콘텐츠가 떠 있다.
 */
export function Workspace() {
  const [spaces, setSpaces] = useState(initialSpaces);
  const [spaceId, setSpaceId] = useState(initialSpaces[0].id);
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(defaultSettings);
  const jobs = useLiveActivity();
  const space = spaces.find((s) => s.id === spaceId) ?? spaces[0];
  const nextSpace = extraSpaces.find((extra) => !spaces.some((s) => s.id === extra.id));

  // '스페이스 추가' — 미리 준비된 사업장을 하나 붙이고 바로 전환 (저장하지 않음)
  const addSpace = () => {
    if (!nextSpace) return;
    setSpaces((list) => [...list, nextSpace]);
    setSpaceId(nextSpace.id);
  };

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
        spaces={spaces}
        space={space}
        canAddSpace={Boolean(nextSpace)}
        onSpaceChange={setSpaceId}
        onAddSpace={addSpace}
        onOpenCommand={() => setCommandOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="workspace-card">
        <Outlet context={context} />
      </main>
      {commandOpen && <CommandBar onClose={() => setCommandOpen(false)} />}
      {settingsOpen && (
        <SettingsDialog value={settings} onChange={setSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
