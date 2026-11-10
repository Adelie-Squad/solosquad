import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { errorCode, errorText } from '../api/errors';
import { keys, useAccess, useAction, useApprovalPolicy, useKeys, useScopedApi, useUsers } from '../api/queries';
import type { AccessPolicy, ApprovalPolicyRow, Me, PublicUser } from '../api/types.gen';
import { Loading, QueryError, SavedLine } from '../components/Status';
import { categoryLabel, LOCALE_NAMES, LOCALES, useI18n, type Locale, type MessageKey } from '../i18n';
import { useSession } from '../session';
import { useLinks, useOrgOwner, useScope } from '../scope';
import { useLogout } from '../auth/logout';
import { AgentAccessPanel } from './calendar/common';
import { ScopeEyebrow } from '../components/ScopeEyebrow';
import { ScrollLock } from '../components/scrollLock';
import { Modal } from '../components/Modal';
import { ICON } from '../icons';
import { workspaceName } from '../lib/names';
import { AssignmentChips, AssignmentsDialog, AssignmentsEditor, type Assignment } from './settings/Assignments';
import { ConnectionsSettings } from './settings/ConnectionsSettings';
import { PasskeySettings } from './settings/PasskeySettings';
import { CompanySettings } from './settings/CompanySettings';
import { ServerSettings } from './settings/ServerSettings';
import { SnapshotSettings } from './settings/SnapshotSettings';
import { ThemeSettings } from './settings/ThemeSettings';

interface Tab {
  id: string;
  label: MessageKey;
  /** customer = the customer's owner (accounts · server settings); org = this org's owner. */
  ownerOnly: false | 'customer' | 'org';
}

const TABS: Tab[] = [
  { id: 'language', label: 'settings.language', ownerOnly: false },
  { id: 'display', label: 'settings.display', ownerOnly: false },
  { id: 'account', label: 'settings.account', ownerOnly: false },
  { id: 'company', label: 'settings.company', ownerOnly: false },
  { id: 'server', label: 'settings.server', ownerOnly: false },
  { id: 'snapshot', label: 'settings.snapshot', ownerOnly: false },
  { id: 'connections', label: 'connections.title', ownerOnly: false },
  { id: 'access', label: 'settings.access', ownerOnly: 'org' },
  { id: 'approvals', label: 'settings.tiers', ownerOnly: 'org' },
  { id: 'users', label: 'settings.users', ownerOnly: 'customer' },
];

/** Settings — language for everyone; access policy, approval tiers and people for the owner. */
export function SettingsView() {
  const { o: toOrg } = useLinks();
  const { tab = 'language' } = useParams<{ tab?: string }>();
  const { t } = useI18n();
  const { isOwner } = useSession();
  const orgOwner = useOrgOwner();
  const tabs = TABS.filter((x) => !x.ownerOnly || (x.ownerOnly === 'org' ? orgOwner : isOwner));
  if (!tabs.some((x) => x.id === tab)) return <Navigate to={toOrg('/settings')} replace />;

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <ScopeEyebrow />
          <h1>{t('nav.settings')}</h1>
        </div>
      </header>
      <nav className="tabs" aria-label={t('nav.settings')}>
        {tabs.map((x) => (
          <NavLink key={x.id} to={toOrg(x.id === 'language' ? '/settings' : `/settings/${x.id}`)} end className="tab" title={t(x.label)}>
            {t(x.label)}
          </NavLink>
        ))}
      </nav>
      {tab === 'language' && <LanguageSettings />}
      {tab === 'display' && <ThemeSettings />}
      {tab === 'account' && <AccountSettings />}
      {tab === 'company' && <CompanySettings />}
      {tab === 'server' && <ServerSettings />}
      {tab === 'snapshot' && <SnapshotSettings />}
      {tab === 'connections' && <ConnectionsSettings />}
      {tab === 'access' && <AccessSettings />}
      {tab === 'approvals' && <TierSettings />}
      {tab === 'users' && <UserSettings />}
    </div>
  );
}

// ------------------------------------------------------------------ language (I31 · 2026-11-11)

/**
 * My screen language — the only language setting. There is no company default any more: the
 * choice is kept on my account (`PATCH /api/me`, core.db `users.locale`) and follows me to any
 * browser; ko until I choose. This device remembers it too, for the screens before login.
 */
function LanguageSettings() {
  const { t, locale, setLocale } = useI18n();
  const { me } = useSession();
  const qc = useQueryClient();
  const mine = useAction(async (next: Locale) => {
    const saved = await api.patch<Me>('/me', { locale: next });
    qc.setQueryData(keys.me, saved);
    setLocale(saved.locale);
    return saved;
  });
  const own: Locale = me.user ? me.locale : locale;
  return (
    <section className="panel settings-body">
      <div className="field">
        <label htmlFor="my-language">{t('settings.myLanguage')}</label>
        <select
          id="my-language"
          value={own}
          aria-describedby="my-language-hint"
          disabled={mine.isPending || me.local}
          onChange={(e) => mine.mutate(e.target.value as Locale)}
        >
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
        <small id="my-language-hint" className="dash-hint">
          {t('settings.myLanguageHint')}
        </small>
      </div>
      <p className="settings-note">{t('settings.notTranslated')}</p>
      {mine.isSuccess && <SavedLine />}
      {mine.error && <p className="form-error">{t('common.failed')}</p>}
    </section>
  );
}

// ------------------------------------------------------------------ account

function AccountSettings() {
  const { t } = useI18n();
  const { me } = useSession();
  const qc = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const change = useAction(async () => {
    const next = await api.patch<Me>('/me', { password });
    qc.setQueryData(keys.me, next); // relogin: true → back to the login screen
    return next;
  });
  if (me.local) return <section className="panel empty">{t('settings.localToken')}</section>;
  return (
    <>
    <section className="panel">
      <PasskeySettings />
    </section>
    {/* decision 60 rev — how much agents may read of my personal events (people never see them) */}
    <AgentAccessPanel />
    <form
      className="panel settings-body"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError(null);
        change.mutate(undefined, { onError: (err) => setError(errorText(err, t)) });
      }}
    >
      <p>
        <strong>{me.user?.display}</strong>
        {[me.user?.display !== me.user?.username ? me.user?.username : null, me.user?.title]
          .filter(Boolean)
          .map((part) => ` · ${part}`)
          .join('')}
      </p>
      <label className="field">
        <span>{t('settings.newPassword')}</span>
        <input type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
        <small className="dash-hint">{t('settings.passwordHint')}</small>
      </label>
      {error && <p className="form-error">{error}</p>}
      <button className="btn is-primary" disabled={change.isPending || password.length < 10}>
        {t('settings.changePassword')}
      </button>
    </form>
    <LogoutPanel />
    </>
  );
}

/** Log out of this device — at the end of My account, the one place it lives (2026-11-06). */
function LogoutPanel() {
  const { t } = useI18n();
  const logout = useLogout();
  const [busy, setBusy] = useState(false);
  return (
    <section className="panel settings-row is-spread">
      <span className="settings-hint">{t('settings.logoutHint')}</span>
      <button
        type="button"
        className="btn with-icon"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void logout();
        }}
      >
        <ICON.logout />
        {t('nav.logout')}
      </button>
    </section>
  );
}

// ------------------------------------------------------------------ access policy (I24 · K28)

/**
 * Access policy, two layers (decision 57 · I22): the customer's default (core/server.yaml —
 * the customer's owner edits it) and this workspace's extra limits on top of it
 * (workspace.yaml — this org's owner edits them). Both refuse a list that would lock out the
 * person saving it (409) until they confirm.
 */
function AccessSettings() {
  const { t } = useI18n();
  const { isOwner, me } = useSession();
  const scope = useScope();
  const keys = useKeys();
  const { ws: wsApi } = useScopedApi();
  const base = useAccess(true);
  const extra = useQuery({ queryKey: keys.wsAccess, queryFn: () => wsApi.get<AccessPolicy>('/access') });
  return (
    <>
      <section className="settings-section" aria-labelledby="access-default">
        <h2 id="access-default" className="panel-title">{t('access.defaultTitle')}</h2>
        <p className="settings-hint">{t('access.defaultLead')}</p>
        {base.isPending ? (
          <Loading />
        ) : base.error ? (
          <QueryError error={base.error} />
        ) : (
          <AccessForm
            key={JSON.stringify(base.data)}
            current={base.data}
            readOnly={!isOwner}
            put={(body) => api.put<AccessPolicy>('/access', body)}
            queryKey={keys.access}
          />
        )}
      </section>
      <section className="settings-section" aria-labelledby="access-extra">
        <h2 id="access-extra" className="panel-title">{t('access.extraTitle', { ws: workspaceName(me.scopes, scope.org, scope.ws) })}</h2>
        <p className="settings-hint">{t('access.extraLead')}</p>
        {extra.isPending ? (
          <Loading />
        ) : extra.error ? (
          <QueryError error={extra.error} />
        ) : (
          <AccessForm
            key={JSON.stringify(extra.data)}
            current={extra.data}
            readOnly={false}
            put={(body) => wsApi.put<AccessPolicy>('/access', body)}
            queryKey={keys.wsAccess}
          />
        )}
      </section>
    </>
  );
}

function AccessForm({
  current,
  readOnly,
  put,
  queryKey,
}: {
  current: AccessPolicy;
  readOnly: boolean;
  put: (body: Record<string, unknown>) => Promise<AccessPolicy>;
  queryKey: readonly unknown[];
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [nets, setNets] = useState(current.allowed_networks.join('\n'));
  const [twoFactor, setTwoFactor] = useState(current.two_factor);
  const [lockout, setLockout] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (confirm: boolean) => {
    setError(null);
    setSaved(false);
    try {
      const next = await put({
        allowed_networks: nets.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
        two_factor: twoFactor,
        confirm_lockout: confirm || undefined,
      });
      qc.setQueryData(queryKey, next);
      setLockout(null);
      setSaved(true);
    } catch (err) {
      if (errorCode(err) === 'access_lockout') setLockout(errorText(err, t));
      else setError(errorText(err, t));
    }
  };

  return (
    <form
      className="panel settings-body"
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
    >
      {readOnly && <p className="settings-note">{t('settings.readOnly')}</p>}
      <fieldset className="settings-body" disabled={readOnly}>
        <label className="field">
          <span>{t('access.networks')}</span>
          <textarea rows={4} value={nets} onChange={(e) => setNets(e.target.value)} placeholder="203.0.113.0/24" />
          <small className="dash-hint">{t('access.networksHint')}</small>
        </label>
        <label className="settings-row">
          <span>{t('access.twoFactor')}</span>
          <button type="button" className="toggle" role="switch" aria-checked={twoFactor} onClick={() => setTwoFactor((v) => !v)} />
        </label>
      </fieldset>
      {error && <p className="form-error">{error}</p>}
      {saved && <SavedLine />}
      {!readOnly && <button className="btn is-primary">{t('common.save')}</button>}

      {lockout && (
        <div className="command-overlay is-modal" onMouseDown={() => setLockout(null)}>
          <ScrollLock />
          <div className="dialog" role="alertdialog" aria-label={t('access.lockoutTitle')} onMouseDown={(e) => e.stopPropagation()}>
            <h2 className="with-icon is-warn">
              <ICON.warn size={20} />
              {t('access.lockoutTitle')}
            </h2>
            <p>{t('access.lockoutBody')}</p>
            <p className="dash-hint">{lockout}</p>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={() => setLockout(null)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn is-danger" onClick={() => void save(true)}>
                {t('access.lockoutConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}

// ------------------------------------------------------------------ approval tiers (decision 51)

function TierSettings() {
  const q = useApprovalPolicy();
  if (q.isPending) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  return <TierForm key={JSON.stringify(q.data)} rows={q.data} />;
}

function TierForm({ rows }: { rows: ApprovalPolicyRow[] }) {
  const keys = useKeys();
  const { org: orgApi } = useScopedApi();
  const { t, locale } = useI18n();
  const [tiers, setTiers] = useState<Record<string, ApprovalPolicyRow['tier']>>(() => Object.fromEntries(rows.map((r) => [r.category, r.tier])));
  const save = useAction(() => orgApi.put<ApprovalPolicyRow[]>('/approval-policy', { tiers }), [keys.approvalPolicy, keys.approvals]);
  const changed = rows.some((r) => tiers[r.category] !== r.tier);

  return (
    <section className="panel settings-body">
      <p className="settings-hint">{t('tiers.lead')}</p>
      <table className="statement tiers">
        <thead>
          <tr>
            <th>{t('tiers.category')}</th>
            <th>{t('tiers.recommended')}</th>
            <th>{t('tiers.tier')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const now = tiers[r.category];
            const deviates = now !== r.recommended;
            return (
              <tr key={r.category} className={deviates ? 'is-deviating' : ''}>
                <th>{categoryLabel(locale, r.category, r.label)}</th>
                <td>{r.recommended === 'owner' ? t('tier.owner') : t('tier.team')}</td>
                <td>
                  <select
                    value={now}
                    aria-label={t('tiers.tierFor', { category: categoryLabel(locale, r.category, r.label) })}
                    onChange={(e) => setTiers((x) => ({ ...x, [r.category]: e.target.value as ApprovalPolicyRow['tier'] }))}
                  >
                    <option value="owner">{t('tier.owner')}</option>
                    <option value="team">{t('tier.team')}</option>
                  </select>
                </td>
                <td>{deviates && <span className="chip is-warn">{t('tiers.deviates')}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {save.error && <p className="form-error">{t('common.failed')}</p>}
      {save.isSuccess && !changed && <SavedLine />}
      <button className="btn is-primary" disabled={!changed || save.isPending} onClick={() => save.mutate(undefined)}>
        {t('common.save')}
      </button>
    </section>
  );
}

// ------------------------------------------------------------------ users (I25)

function UserSettings() {
  const keys = useKeys();
  const { t } = useI18n();
  const { user: me, me: session } = useSession();
  const q = useUsers(true);
  const [assigning, setAssigning] = useState<PublicUser | null>(null);
  const update = useAction(
    ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch<PublicUser>(`/users/${id}`, body),
    [keys.users, keys.orgChart, keys.people],
  );
  const [error, setError] = useState<string | null>(null);
  const onError = (e: unknown) => setError(errorText(e, t));
  const act = (id: string, body: Record<string, unknown>) => {
    setError(null);
    update.mutate({ id, body }, { onError });
  };

  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const table = useRef<HTMLTableElement>(null);
  // the new member's row takes focus once the modal has handed focus back (2026-11-11)
  useEffect(() => {
    if (!added) return;
    const id = setTimeout(() => {
      table.current?.querySelector<HTMLElement>(`[data-user="${CSS.escape(added)}"]`)?.focus();
    }, 30);
    return () => clearTimeout(id);
  }, [added, q.data]);

  if (q.isPending) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  return (
    <div className="settings-stack">
      <div className="members-head">
        <p className="settings-hint">{t('users.lead')}</p>
        <button type="button" className="btn is-primary with-icon" onClick={() => setAdding(true)}>
          <ICON.new />
          {t('users.add')}
        </button>
      </div>
      {error && <p className="form-error">{error}</p>}
      <table className="statement users" ref={table} aria-label={t('settings.users')}>
        <thead>
          <tr>
            <th>{t('users.name')}</th>
            <th>{t('users.role')}</th>
            <th>{t('assign.column')}</th>
            <th>{t('users.twoFactor')}</th>
            <th>{t('users.status')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {q.data.map((u) => (
            <tr key={u.id} className={`${u.disabled ? 'is-off' : ''} ${u.id === added ? 'is-new' : ''}`.trim() || undefined} data-user={u.id} tabIndex={-1}>
              <th>
                {u.display} <span className="dash-hint">@{u.username}</span>
              </th>
              <td data-label={t('users.role')}>
                <select value={u.role} disabled={u.id === me?.id} onChange={(e) => act(u.id, { role: e.target.value })} aria-label={t('users.role')}>
                  <option value="owner">{t('role.owner')}</option>
                  <option value="staff">{t('role.staff')}</option>
                </select>
              </td>
              <td data-label={t('assign.column')} className="users-assign">
                <span className="users-assign-body">
                  {u.role === 'owner' ? (
                    <span className="chip">{t('assign.everything')}</span>
                  ) : (
                    <>
                      <AssignmentChips list={u.assignments} scopes={session.scopes} />
                      <button className="btn is-small" onClick={() => setAssigning(u)}>
                        {t('assign.edit')}
                      </button>
                    </>
                  )}
                </span>
              </td>
              <td data-label={t('users.twoFactor')}>
                {u.two_factor ? (
                  <span className="chip is-ok">
                    <ICON.done size={14} />
                    {t('users.enrolled')}
                  </span>
                ) : (
                  t('users.notEnrolled')
                )}
              </td>
              <td data-label={t('users.status')}>{u.disabled ? t('users.disabled') : t('users.enabled')}</td>
              <td className="row-actions">
                {u.id !== me?.id && (
                  <>
                    <button className="btn is-small" onClick={() => act(u.id, { disabled: !u.disabled })}>
                      {u.disabled ? t('users.enable') : t('users.disable')}
                    </button>
                    <button
                      className="btn is-small"
                      onClick={() => window.confirm(t('users.confirmResetCode', { name: u.display })) && act(u.id, { reset_totp: true })}
                    >
                      {t('users.resetCode')}
                    </button>
                    <button
                      className="btn is-small"
                      onClick={() => window.confirm(t('users.confirmResetPasskeys', { name: u.display })) && act(u.id, { reset_passkeys: true })}
                    >
                      {t('users.resetPasskeys')}
                    </button>
                    <button
                      className="btn is-small"
                      onClick={() => {
                        const pw = window.prompt(t('users.newPasswordFor', { name: u.display }));
                        if (pw) act(u.id, { password: pw });
                      }}
                    >
                      {t('users.resetPassword')}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {adding && (
        <AddMemberModal
          onClose={() => setAdding(false)}
          onAdded={(u) => {
            setAdding(false);
            setAdded(u.id);
          }}
        />
      )}
      {assigning && (
        <AssignmentsDialog
          name={assigning.display}
          initial={assigning.assignments}
          scopes={session.scopes}
          busy={update.isPending}
          error={error}
          onClose={() => setAssigning(null)}
          onSave={(assignments) => {
            setError(null);
            update.mutate({ id: assigning.id, body: { assignments } }, { onError, onSuccess: () => setAssigning(null) });
          }}
        />
      )}
    </div>
  );
}

const MIN_PASSWORD = 10;
type Field = 'username' | 'password' | 'assignments';

/**
 * 구성원 추가 — a modal from the 구성원 tab's one button (2026-11-11; it was an inline form). The
 * same fields the form had: username, display name, first password, role (대표 · 팀원), the
 * businesses and workspaces a 팀원 may open (teams and titles stay in the org chart), plus the
 * screen language they start with (ko). Checked here first, then by the server; a server error
 * shows in the modal. On success the member is in the list and their row takes focus.
 */
function AddMemberModal({ onClose, onAdded }: { onClose: () => void; onAdded: (u: PublicUser) => void }) {
  const keys = useKeys();
  const qc = useQueryClient();
  const { t } = useI18n();
  const scope = useScope();
  const { me: session } = useSession();
  const [form, setForm] = useState({ username: '', display: '', password: '', role: 'staff' as 'staff' | 'owner', locale: 'ko' as Locale });
  const [assignments, setAssignments] = useState<Assignment[]>([{ org: scope.org, workspace: null, role: 'staff' }]);
  const [problems, setProblems] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const create = useAction(
    () => api.post<PublicUser>('/users', { ...form, assignments: form.role === 'owner' ? [] : assignments }),
    [keys.users, keys.orgChart, keys.people],
  );
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setProblems((p) => ({ ...p, [k]: undefined }));
  };
  const check = () => {
    const found: Partial<Record<Field, string>> = {};
    if (!form.username.trim()) found.username = t('users.usernameRequired');
    if (form.password.length < MIN_PASSWORD) found.password = t('users.passwordShort', { n: MIN_PASSWORD });
    if (form.role === 'staff' && !assignments.length) found.assignments = t('users.assignRequired');
    setProblems(found);
    return !Object.keys(found).length;
  };
  const describe = (f: Field) => (problems[f] ? `member-${f}-error` : undefined);
  return (
    <Modal label={t('users.addTitle')} onClose={onClose} className="member-modal" focusFirstField>
      <form
        className="settings-body"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (!check()) return;
          create.mutate(undefined, {
            onSuccess: (u) => {
              qc.setQueryData<PublicUser[]>(keys.users, (list) => (list && !list.some((x) => x.id === u.id) ? [...list, u] : list));
              onAdded(u);
            },
            onError: (err) => {
              const code = errorCode(err);
              if (code === 'username_taken' || code === 'username_invalid') setProblems({ username: errorText(err, t) });
              else if (code === 'password_too_short') setProblems({ password: errorText(err, t) });
              else setError(errorText(err, t));
            },
          });
        }}
      >
        <h2 className="member-modal-title">{t('users.addTitle')}</h2>
        <p className="settings-hint">{t('users.addHint')}</p>
        <div className="member-grid">
          <div className="field">
            <label htmlFor="member-username">{t('users.username')}</label>
            <input
              id="member-username"
              value={form.username}
              autoComplete="off"
              maxLength={64}
              onChange={(e) => set('username', e.target.value)}
              aria-invalid={!!problems.username}
              aria-describedby={describe('username')}
            />
            {problems.username && (
              <small id="member-username-error" className="form-error">
                {problems.username}
              </small>
            )}
          </div>
          <label className="field">
            <span>{t('users.display')}</span>
            <input value={form.display} maxLength={80} onChange={(e) => set('display', e.target.value)} />
          </label>
          <div className="field">
            <label htmlFor="member-password">{t('users.initialPassword')}</label>
            <input
              id="member-password"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              aria-invalid={!!problems.password}
              aria-describedby={describe('password')}
            />
            {problems.password && (
              <small id="member-password-error" className="form-error">
                {problems.password}
              </small>
            )}
          </div>
          <label className="field">
            <span>{t('users.role')}</span>
            <select value={form.role} onChange={(e) => set('role', e.target.value as 'staff' | 'owner')}>
              <option value="staff">{t('role.staff')}</option>
              <option value="owner">{t('role.owner')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('settings.myLanguage')}</span>
            <select value={form.locale} onChange={(e) => set('locale', e.target.value as Locale)}>
              {LOCALES.map((l) => (
                <option key={l} value={l}>
                  {LOCALE_NAMES[l]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {form.role === 'owner' ? (
          <p className="dash-hint">{t('users.ownerAll')}</p>
        ) : (
          <fieldset className="field" aria-describedby={describe('assignments')}>
            <legend>{t('assign.column')}</legend>
            <AssignmentsEditor
              value={assignments}
              scopes={session.scopes}
              onChange={(next) => {
                setAssignments(next);
                setProblems((p) => ({ ...p, assignments: undefined }));
              }}
            />
            {problems.assignments && (
              <small id="member-assignments-error" className="form-error">
                {problems.assignments}
              </small>
            )}
          </fieldset>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn is-primary with-icon" disabled={create.isPending}>
            <ICON.new />
            {t('users.submitAdd')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
