// The names and role summaries people read for agents (DESIGN.md `## 문구` — 이름 표기).
// They live in each agent's SKILL.md (`display_name` · `summary`, per language) and come with
// `/api/…/agents`. An agent without them — a customer's own, or an id the engine mentions —
// shows its id made readable: `backend-engineer` → `Backend Engineer`. Ids never reach the
// screen (developer logs aside).
import { useCallback } from 'react';
import { useAgents } from '../api/queries';
import type { Agent, AgentCard } from '../api/types.gen';
import { useI18n, type Locale } from '../i18n';
import { readable } from './names';

type Words = Record<string, string> | null | undefined;

/** The reader's language, then English, then Korean, then any. */
export function localized(words: Words, locale: Locale): string | undefined {
  if (!words) return undefined;
  return words[locale] || words.en || words.ko || Object.values(words).find(Boolean) || undefined;
}

/** A plain id (`sales`, `data-engineer`) is made readable; anything else is shown as it is. */
export function readableId(id: string): string {
  return /^[a-z0-9][a-z0-9_-]*$/i.test(id) ? readable(id) : id;
}

export function agentName(id: string, locale: Locale, agent?: Pick<Agent | AgentCard, 'display_name'> | null): string {
  return localized(agent?.display_name, locale) ?? readableId(id);
}

export function agentSummary(locale: Locale, agent?: Pick<Agent | AgentCard, 'summary'> | null): string | undefined {
  return localized(agent?.summary, locale);
}

/** `name(id)` → the display name in the reader's language, from this workspace's agents. */
export function useAgentName(): (id: string | null | undefined) => string {
  const { locale } = useI18n();
  const agents = useAgents();
  const list = agents.data;
  return useCallback(
    (id) => {
      if (!id) return '';
      return agentName(id, locale, list?.find((a) => a.name === id));
    },
    [list, locale],
  );
}
