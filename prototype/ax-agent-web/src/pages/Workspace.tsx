import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { CommandBar } from '../components/CommandBar';
import { SettingsDialog } from '../components/SettingsDialog';
import { Sidebar } from '../components/Sidebar';
import { defaultSettings, space } from '../data/dummy';
import { useLiveActivity } from '../hooks/useLiveActivity';
import type { WorkspaceContext } from '../workspace-context';
import './Workspace.css';

/**
 * 서비스 페이지 셸 — Arc 브라우저 레이아웃.
 * 사업장 색 그라디언트가 창 전체를 덮고, 왼쪽에 투명한 사이드바(LNB),
 * 오른쪽에 둥근 흰 카드 하나로 콘텐츠가 떠 있다.
 */
export function Workspace() {
  const [commandOpen, setCommandOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(defaultSettings);
  const jobs = useLiveActivity();

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
