import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { keys, useAccess, useAction, useApprovalPolicy, useKeys, useScopedApi, useSettings, useUsers } from '../api/queries';
import type { AccessPolicy, ApprovalPolicyRow, Me, PublicUser, WebSettings } from '../api/types.gen';
import { Loading, QueryError } from '../components/Status';
import { categoryLabel, LOCALE_NAMES, LOCALES, useI18n, type Locale, type MessageKey } from '../i18n';
import { useSession } from '../session';
import { useLinks, useOrgOwner, useScope } from '../scope';
import { AssignmentChips, AssignmentsDialog, AssignmentsEditor, type Assignment } from './settings/Assignments';
import { PasskeySettings } from './settings/PasskeySettings';
import { ProfileSettings } from './settings/ProfileSettings';
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
  { id: 'profile', label: 'settings.profile', ownerOnly: false },
  { id: 'snapshot', label: 'settings.snapshot', ownerOnly: false },
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
          <h1>{t('nav.settings')}</h1>
        </div>
      </header>
      <nav className="tabs" aria-label={t('nav.settings')}>
        {tabs.map((x) => (
          <NavLink key={x.id} to={x.id === 'language' ? '/settings' : `/settings/${x.id}`} end className="tab">
            {t(x.label)}
          </NavLink>
        ))}
      </nav>
      {tab === 'language' && <LanguageSettings />}
      {tab === 'display' && <ThemeSettings />}
      {tab === 'account' && <AccountSettings />}
      {tab === 'profile' && <ProfileSettings />}
      {tab === 'snapshot' && <SnapshotSettings />}
      {tab === 'access' && <AccessSettings />}
      {tab === 'approvals' && <TierSettings />}
      {tab === 'users' && <UserSettings />}
    </div>
  );
}

// ------------------------------------------------------------------ language (I31)

function LanguageSettings() {
  const { t, setLocale } = useI18n();
  const { me, isOwner } = useSession();
  const qc = useQueryClient();
  const org = useSettings();
  const own = me.user?.locale ?? '';
  const mine = useAction(async (locale: Locale | null) => {
    const next = await api.patch<Me>('/me', { locale });
    qc.setQueryData(keys.me, next);
    setLocale(next.locale);
    return next;
  });
  const orgSave = useAction(
    async (locale: Locale) => {
      const saved = await api.put<WebSettings>('/settings', { locale });
      await qc.invalidateQueries({ queryKey: keys.me });
      return saved;
    },
    [keys.settings],
  );

  return (
    <section className="panel settings-body">
      <label className="field">
        <span>{t('settings.myLanguage')}</span>
        <select
          value={own}
          disabled={mine.isPending || me.local}
          onChange={(e) => mine.mutate(e.target.value ? (e.target.value as Locale) : null)}
        >
          <option value="">{t('settings.followOrg', { lang: LOCALE_NAMES[me.org_locale] })}</option>
          {LOCALES.map((l) => (
            <option key={l} value={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      </label>
      {isOwner && (
        <label className="field">
          <span>{t('settings.orgLanguage')}</span>
          <select value={org.data?.locale ?? me.org_locale} disabled={orgSave.isPending} onChange={(e) => orgSave.mutate(e.target.value as Locale)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_NAMES[l]}
              </option>
            ))}
          </select>
          <small className="dash-hint">{t('settings.orgLanguageHint')}</small>
        </label>
      )}
      <p className="settings-note">{t('settings.notTranslated')}</p>
      {(mine.error || orgSave.error) && <p className="form-error">{t('common.failed')}</p>}
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
    <form
      className="panel settings-body"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        setError(null);
        change.mutate(undefined, { onError: (err) => setError(err instanceof ApiError ? err.message : t('common.failed')) });
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
    </>
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
  const { isOwner } = useSession();
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
        <h2 id="access-extra" className="panel-title">{t('access.extraTitle', { ws: scope.ws })}</h2>
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
      if (err instanceof ApiError && err.status === 409) setLockout(err.message);
      else setError(err instanceof ApiError ? err.message : t('common.failed'));
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
      {saved && <p className="ok-line">✓ {t('common.saved')}</p>}
      {!readOnly && <button className="btn is-primary">{t('common.save')}</button>}

      {lockout && (
        <div className="command-overlay is-modal" onMouseDown={() => setLockout(null)}>
          <div className="dialog" role="alertdialog" aria-label={t('access.lockoutTitle')} onMouseDown={(e) => e.stopPropagation()}>
            <h2>⚠️ {t('access.lockoutTitle')}</h2>
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
      {save.isSuccess && !changed && <p className="ok-line">✓ {t('common.saved')}</p>}
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
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t('common.failed'));
  const act = (id: string, body: Record<string, unknown>) => {
    setError(null);
    update.mutate({ id, body }, { onError });
  };

  if (q.isPending) return <Loading />;
  if (q.error) return <QueryError error={q.error} />;
  return (
    <section className="panel settings-body">
      <NewUser />
      {error && <p className="form-error">{error}</p>}
      <table className="statement users">
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
            <tr key={u.id} className={u.disabled ? 'is-off' : ''}>
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
              <td data-label={t('users.twoFactor')}>{u.two_factor ? '✓' : t('users.notEnrolled')}</td>
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
    </section>
  );
}

function NewUser() {
  const keys = useKeys();
  const { t } = useI18n();
  const scope = useScope();
  const { me: session } = useSession();
  const blank = { username: '', display: '', password: '', role: 'staff' };
  const [form, setForm] = useState(blank);
  const [assignments, setAssignments] = useState<Assignment[]>([{ org: scope.org, workspace: null, role: 'staff' }]);
  const [error, setError] = useState<string | null>(null);
  const create = useAction(
    () => api.post<PublicUser>('/users', { ...form, assignments: form.role === 'owner' ? [] : assignments }),
    [keys.users, keys.orgChart, keys.people],
  );
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <form
      className="form-row"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        create.mutate(undefined, {
          onSuccess: () => setForm(blank),
          onError: (err) => setError(err instanceof ApiError ? err.message : t('common.failed')),
        });
      }}
    >
      <input placeholder={t('users.username')} value={form.username} onChange={set('username')} required />
      <input placeholder={t('users.display')} value={form.display} onChange={set('display')} />
      <input placeholder={t('users.initialPassword')} type="password" autoComplete="new-password" minLength={10} value={form.password} onChange={set('password')} required />
      <select value={form.role} onChange={set('role')} aria-label={t('users.role')}>
        <option value="staff">{t('role.staff')}</option>
        <option value="owner">{t('role.owner')}</option>
      </select>
      <button className="btn is-primary" disabled={create.isPending}>
        + {t('users.add')}
      </button>
      {form.role !== 'owner' && (
        <div className="assign-new">
          <span className="dash-hint">{t('assign.column')}</span>
          <AssignmentsEditor value={assignments} scopes={session.scopes} onChange={setAssignments} />
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <p className="dash-hint">{t('users.addHint')}</p>
    </form>
  );
}
