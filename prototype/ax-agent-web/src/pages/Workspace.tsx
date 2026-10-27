import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { CommandBar } from '../components/CommandBar';
import { SettingsDialog } from '../components/SettingsDialog';
import { Sidebar } from '../components/Sidebar';
import {
  categoryById,
  defaultMembers,
  defaultSettings,
  defaultSnsPosts,
  defaultSourcingRequests,
  defaultWorkflows,
  factoryQuotes,
  ledgerEntries,
  space,
} from '../data/dummy';
import { useLiveActivity } from '../hooks/useLiveActivity';
import { attentionFor } from '../lib/workflows';
import { accessFor, type FinanceState, type WorkflowState, type WorkspaceContext } from '../workspace-context';
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
  const [members, setMembers] = useState(defaultMembers);
  const [viewerId, setViewerId] = useState(defaultMembers[0].id);
  const [finance, setFinance] = useState<FinanceState>({ importedFile: null, ledger: ledgerEntries });
  const [wf, setWf] = useState<WorkflowState>({
    workflows: defaultWorkflows,
    sourcingRequests: defaultSourcingRequests,
    quotes: factoryQuotes,
    chosenQuote: {},
    snsPosts: defaultSnsPosts,
  });
  const { jobs, sessionTokens } = useLiveActivity();

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

  const viewer = members.find((m) => m.id === viewerId) ?? members[0];
  const canAccess = accessFor(viewer);
  const visibleJobs = jobs.filter((j) => canAccess(j.category));
  const workflowAttention = wf.workflows
    .filter((w) => canAccess(w.category))
    .reduce((sum, w) => sum + attentionFor(w.id, wf, finance), 0);

  const context: WorkspaceContext = {
    jobs: visibleJobs,
    sessionTokens,
    space,
    viewer,
    canAccess,
    finance,
    setFinance,
    wf,
    setWf,
  };

  return (
    <div
      className="workspace"
      style={{ background: space.gradient, ['--accent' as string]: space.accent }}
    >
      <Sidebar
        jobs={visibleJobs}
        space={space}
        viewer={viewer}
        canAccess={canAccess}
        workflowAttention={workflowAttention}
        onOpenCommand={() => setCommandOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="workspace-card">
        {!viewer.master && (
          <div className="viewer-banner" role="status">
            <span>
              {viewer.emoji} <strong>{viewer.name}</strong> 님 화면으로 보는 중 ·{' '}
              {viewer.categories.map((c) => categoryById[c].label).join(', ')} 업무만 보여요
            </span>
            <button className="btn" onClick={() => setViewerId(members[0].id)}>
              사장님 화면으로 돌아가기
            </button>
          </div>
        )}
        <Outlet context={context} />
      </main>
      {commandOpen && <CommandBar onClose={() => setCommandOpen(false)} />}
      {settingsOpen && (
        <SettingsDialog
          value={settings}
          onChange={setSettings}
          members={members}
          onMembersChange={setMembers}
          viewer={viewer}
          onViewAs={(id) => {
            setViewerId(id);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
