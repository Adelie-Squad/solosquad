// The switch menu at the top of the sidebar (DESIGN.md `## 레이아웃` · `## 컴포넌트` 전환 메뉴):
// org → workspace, only what the person is assigned (decision 57 ⑵). One choice only = just
// the names. Arrow keys move, Enter opens, Esc closes; the current scope is bold with a check.
// Names are the display names (lib/names.ts), never the raw ids.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ScopeOrg } from '../api/types.gen';
import { useI18n } from '../i18n';
import { ICON } from '../icons';
import { orgName as orgNameOf, shownName, workspaceName } from '../lib/names';
import { routes, usePickedScope, useScope } from '../scope';
import { useSession } from '../session';

export interface ScopeChoice {
  org: string;
  orgDisplay: string;
  ws: string;
  wsDisplay: string;
  running: boolean;
}

/** Flatten the assignments into the menu's rows, in the server's order. */
export function scopeChoices(scopes: ScopeOrg[]): ScopeChoice[] {
  return scopes.flatMap((o) =>
    o.workspaces.map((w) => ({
      org: o.org,
      orgDisplay: shownName(o.org, o.display),
      ws: w.name,
      wsDisplay: shownName(w.name, w.display),
      running: w.running,
    })),
  );
}

export function ScopeSwitcher({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const { me } = useSession();
  const scope = useScope();
  const navigate = useNavigate();
  const { pick } = usePickedScope();
  const choices = scopeChoices(me.scopes);
  const here = choices.findIndex((c) => c.org === scope.org && c.ws === scope.ws);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(Math.max(0, here));
  const listRef = useRef<HTMLUListElement>(null);
  const current = choices[here];
  const orgName = orgNameOf(me.scopes, scope.org);
  const wsName = workspaceName(me.scopes, scope.org, scope.ws);

  useEffect(() => {
    if (open) {
      setCursor(Math.max(0, here));
      listRef.current?.focus();
    }
  }, [open, here]);

  if (choices.length <= 1 && !compact) {
    return (
      <div className="scope-switch is-single" aria-label={t('scope.current')}>
        <strong title={orgName}>{orgName}</strong>
        <span title={wsName}>{wsName}</span>
      </div>
    );
  }

  const go = (c: ScopeChoice) => {
    setOpen(false);
    // an account screen stays where it is — only the workspace tiles below follow the choice
    if (scope.account) pick({ org: c.org, ws: c.ws });
    else navigate(routes.ws(c.org, c.ws));
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(choices.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = choices[cursor];
      if (c) go(c);
    }
  };

  const menu = (extra = '') => (
        <>
          <div className="scope-switch-scrim" onClick={() => setOpen(false)} aria-hidden />
          <ul
            ref={listRef}
            className={`scope-switch-menu ${extra}`.trim()}
            role="listbox"
            tabIndex={-1}
            aria-label={t('scope.switch')}
            aria-activedescendant={`scope-opt-${cursor}`}
            onKeyDown={onKey}
          >
            {choices.map((c, i) => {
              const first = i === 0 || choices[i - 1].org !== c.org;
              const isHere = i === here;
              return (
                <li key={`${c.org}/${c.ws}`} role="presentation">
                  {first && <p className="scope-switch-org">{c.orgDisplay}</p>}
                  <div
                    id={`scope-opt-${i}`}
                    role="option"
                    aria-selected={isHere}
                    className={`scope-switch-option ${i === cursor ? 'is-cursor' : ''} ${isHere ? 'is-current' : ''}`}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(c)}
                  >
                    <span className="scope-switch-name">{c.wsDisplay}</span>
                    {!c.running && <span className="chip is-muted">{t('scope.stopped')}</span>}
                    {isHere && <ICON.check className="scope-switch-check" />}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
  );

  if (compact) {
    // the rail: the business's first letter opens the same menu (or just names it, when only one)
    const label = `${t('scope.current')} · ${orgName} · ${wsName}`;
    return (
      <div className="scope-switch is-rail">
        <button
          className="rail-scope"
          aria-label={label}
          title={label}
          aria-haspopup={choices.length > 1 ? 'listbox' : undefined}
          aria-expanded={choices.length > 1 ? open : undefined}
          onClick={() => choices.length > 1 && setOpen((o) => !o)}
        >
          {Array.from(orgName)[0] ?? '?'}
        </button>
        {open && choices.length > 1 && menu('rail-scope-menu')}
      </div>
    );
  }

  return (
    <div className="scope-switch">
      <button
        className="scope-switch-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <strong title={orgName}>{orgName}</strong>
        <span title={wsName}>{current?.wsDisplay ?? wsName}</span>
        <ICON.switch className="scope-switch-caret" />
      </button>
      {open && menu()}
    </div>
  );
}
