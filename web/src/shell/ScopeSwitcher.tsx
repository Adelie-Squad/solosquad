// The switch menu at the top of the sidebar (DESIGN.md `## 레이아웃` · `## 컴포넌트` 전환 메뉴):
// org → workspace, only what the person is assigned (decision 57 ⑵). One choice only = just
// the names. ↑↓ moves, Enter opens, Esc closes; the current scope is bold with ✓.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ScopeOrg } from '../api/types.gen';
import { useI18n } from '../i18n';
import { routes, useScope } from '../scope';
import { useSession } from '../session';

export interface ScopeChoice {
  org: string;
  orgDisplay: string;
  ws: string;
  running: boolean;
}

/** Flatten the assignments into the menu's rows, in the server's order. */
export function scopeChoices(scopes: ScopeOrg[]): ScopeChoice[] {
  return scopes.flatMap((o) => o.workspaces.map((w) => ({ org: o.org, orgDisplay: o.display || o.org, ws: w.name, running: w.running })));
}

export function ScopeSwitcher() {
  const { t } = useI18n();
  const { me } = useSession();
  const scope = useScope();
  const navigate = useNavigate();
  const choices = scopeChoices(me.scopes);
  const here = choices.findIndex((c) => c.org === scope.org && c.ws === scope.ws);
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(Math.max(0, here));
  const listRef = useRef<HTMLUListElement>(null);
  const current = choices[here];
  const orgName = me.scopes.find((o) => o.org === scope.org)?.display || scope.org;

  useEffect(() => {
    if (open) {
      setCursor(Math.max(0, here));
      listRef.current?.focus();
    }
  }, [open, here]);

  if (choices.length <= 1) {
    return (
      <div className="scope-switch is-single" aria-label={t('scope.current')}>
        <strong>{orgName}</strong>
        <span>{scope.ws}</span>
      </div>
    );
  }

  const go = (c: ScopeChoice) => {
    setOpen(false);
    navigate(routes.ws(c.org, c.ws));
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
        <strong>{orgName}</strong>
        <span>{current?.ws ?? scope.ws}</span>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <>
          <div className="scope-switch-scrim" onClick={() => setOpen(false)} aria-hidden />
          <ul
            ref={listRef}
            className="scope-switch-menu"
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
                    <span>{c.ws}</span>
                    {!c.running && <span className="chip is-muted">{t('scope.stopped')}</span>}
                    {isHere && <span aria-hidden>✓</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
