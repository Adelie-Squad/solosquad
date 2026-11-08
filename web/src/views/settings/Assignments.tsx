// Who may open which business (decision 57 · I39): a person's assignments — an org (whole)
// or one workspace of it — each with a role. The owner edits them in Settings › People.
import { useState } from 'react';
import type { AssignmentOut, ScopeOrg } from '../../api/types.gen';
import { useI18n } from '../../i18n';
import { ICON } from '../../icons';
import { orgName, shownName, workspaceName } from '../../lib/names';
import { useScrollLock } from '../../components/scrollLock';

export type Assignment = AssignmentOut;

/** One line per assignment: "tesla · whole org · staff" / "tesla/charging · staff". */
export function AssignmentChips({ list, scopes }: { list: Assignment[]; scopes: ScopeOrg[] }) {
  const { t } = useI18n();
  if (!list.length) return <span className="dash-hint">{t('assign.none')}</span>;
  return (
    <span className="assign-chips">
      {list.map((a) => (
        <span key={`${a.org}/${a.workspace ?? ''}`} className="chip">
          {orgName(scopes, a.org)}
          {a.workspace ? ` / ${workspaceName(scopes, a.org, a.workspace)}` : ` · ${t('assign.wholeOrg')}`} · {a.role === 'owner' ? t('role.owner') : t('role.staff')}
        </span>
      ))}
    </span>
  );
}

/** Edit the whole list (PATCH replaces it). Options = the orgs and workspaces this owner sees. */
export function AssignmentsEditor({
  value,
  scopes,
  onChange,
}: {
  value: Assignment[];
  scopes: ScopeOrg[];
  onChange: (next: Assignment[]) => void;
}) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<Assignment>) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const first = scopes[0];
  return (
    <div className="assign-editor">
      {value.map((a, i) => {
        const org = scopes.find((o) => o.org === a.org);
        return (
          <div key={i} className="form-row assign-row">
            <select aria-label={t('assign.org')} value={a.org} onChange={(e) => set(i, { org: e.target.value, workspace: null })}>
              {scopes.map((o) => (
                <option key={o.org} value={o.org}>
                  {shownName(o.org, o.display)}
                </option>
              ))}
            </select>
            <select
              aria-label={t('assign.workspace')}
              value={a.workspace ?? ''}
              onChange={(e) => set(i, { workspace: e.target.value || null })}
            >
              <option value="">{t('assign.wholeOrg')}</option>
              {(org?.workspaces ?? []).map((w) => (
                <option key={w.name} value={w.name}>
                  {shownName(w.name, w.display)}
                </option>
              ))}
            </select>
            <select aria-label={t('users.role')} value={a.role} onChange={(e) => set(i, { role: e.target.value as Assignment['role'] })}>
              <option value="staff">{t('role.staff')}</option>
              <option value="owner">{t('role.owner')}</option>
            </select>
            <button type="button" className="btn is-small" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              {t('common.remove')}
            </button>
          </div>
        );
      })}
      {first && (
        <button type="button" className="btn is-small" onClick={() => onChange([...value, { org: first.org, workspace: null, role: 'staff' }])}>
          <ICON.new />
          {t('assign.add')}
        </button>
      )}
    </div>
  );
}

/** The dialog around the editor for one person. */
export function AssignmentsDialog({
  name,
  initial,
  scopes,
  busy,
  error,
  onSave,
  onClose,
}: {
  name: string;
  initial: Assignment[];
  scopes: ScopeOrg[];
  busy: boolean;
  error: string | null;
  onSave: (next: Assignment[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<Assignment[]>(initial);
  useScrollLock();
  return (
    <div className="command-overlay is-modal" onMouseDown={onClose}>
      <form
        className="dialog is-wide"
        role="dialog"
        aria-label={t('assign.title', { name })}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSave(list);
        }}
      >
        <h2>{t('assign.title', { name })}</h2>
        <p className="dash-hint">{t('assign.hint')}</p>
        <AssignmentsEditor value={list} scopes={scopes} onChange={setList} />
        {error && <p className="form-error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn is-primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
