// vite.config.ts `agentCatalog` — the bundled agents' frontmatter words, by agent id.
declare module 'virtual:agent-catalog' {
  const catalog: Record<string, { display_name: Record<string, string> | null; summary: Record<string, string> | null }>;
  export default catalog;
}
