// The bundled team as the landing shows it before anyone logs in (DESIGN.md `## 랜딩`): order and
// team from the roster, names and summaries from each agent's SKILL.md (read at build time —
// vite.config.ts `agentCatalog`), shown through the same functions as the app (lib/agentNames).
import catalog from 'virtual:agent-catalog';
import { ROSTER } from '../characters/roster';

export interface CatalogAgent {
  id: string;
  team: string;
  display_name: Record<string, string>;
  summary: Record<string, string>;
}

export interface CatalogTeam {
  team: string;
  agents: CatalogAgent[];
}

/** Teams in roster order (core first), each agent in roster order. */
export const TEAMS: CatalogTeam[] = (() => {
  const out: CatalogTeam[] = [];
  for (const [id, entry] of Object.entries(ROSTER)) {
    const words = catalog[id];
    const agent: CatalogAgent = { id, team: entry.team, display_name: words?.display_name ?? {}, summary: words?.summary ?? {} };
    const group = out.find((g) => g.team === entry.team);
    if (group) group.agents.push(agent);
    else out.push({ team: entry.team, agents: [agent] });
  }
  return out;
})();

export const AGENT_COUNT = TEAMS.reduce((n, g) => n + g.agents.length, 0);

export const byId = (id: string): CatalogAgent | undefined => TEAMS.flatMap((g) => g.agents).find((a) => a.id === id);
