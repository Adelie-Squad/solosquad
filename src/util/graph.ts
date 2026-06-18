/**
 * v1.3.2 §9.2 — domain-agnostic directed-graph core.
 *
 * Shared by agent-manager (delegation graph built from `collaborators`/
 * `used_by`) and workflow-manager (stage graph built from `depends_on`).
 *
 * Cycle detection is Kahn's algorithm (topological peel, O(V+E)) to find the
 * set of nodes that participate in *some* cycle; a bounded DFS over that
 * subgraph then recovers concrete node paths so callers can report
 * "a → b → a" rather than a bare "a cycle exists".
 */

export interface GraphNode {
  id: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  /** Provenance label for diagnostics (which field declared the edge). */
  field?: string;
}

function adjacency(nodeIds: Set<string>, edges: GraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) continue;
    if (!adj.has(e.from)) adj.set(e.from, new Set());
    adj.get(e.from)!.add(e.to);
  }
  return adj;
}

/**
 * Return every distinct simple cycle as an ordered node-id path with the
 * entry node repeated at the end (e.g. `["a","b","a"]`). A self-loop `a→a`
 * comes back as `["a","a"]`. Empty result ⇒ the graph is a DAG.
 */
export function detectCycles(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const ids = new Set(nodes.map((n) => n.id));
  const adj = adjacency(ids, edges);

  // 1) Kahn peel — whatever cannot be ordered is part of a cycle.
  const indeg = new Map<string, number>();
  for (const id of ids) indeg.set(id, 0);
  for (const [, tos] of adj) {
    for (const to of tos) indeg.set(to, (indeg.get(to) ?? 0) + 1);
  }
  const queue: string[] = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  const removed = new Set<string>();
  while (queue.length) {
    const n = queue.shift()!;
    removed.add(n);
    for (const m of adj.get(n) ?? []) {
      indeg.set(m, (indeg.get(m) ?? 0) - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  const inCycle = new Set([...ids].filter((id) => !removed.has(id)));
  if (inCycle.size === 0) return [];

  // 2) DFS within the cycle-only subgraph to recover concrete paths.
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const done = new Set<string>();

  const dfs = (node: string): void => {
    stack.push(node);
    onStack.add(node);
    for (const next of adj.get(node) ?? []) {
      if (!inCycle.has(next)) continue;
      if (onStack.has(next)) {
        const start = stack.indexOf(next);
        const path = [...stack.slice(start), next];
        const sig = canonicalSignature(path);
        if (!seen.has(sig)) {
          seen.add(sig);
          cycles.push(path);
        }
      } else if (!done.has(next)) {
        dfs(next);
      }
    }
    stack.pop();
    onStack.delete(node);
    done.add(node);
  };

  for (const id of inCycle) if (!done.has(id)) dfs(id);
  return cycles;
}

/** Rotation-invariant signature so `a→b→a` and `b→a→b` dedupe to one cycle. */
function canonicalSignature(path: string[]): string {
  const nodes = path.slice(0, -1); // drop the repeated closing node
  if (nodes.length === 0) return "";
  let minIdx = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (nodes[i] < nodes[minIdx]) minIdx = i;
  }
  return [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)].join("→");
}

/** Node ids reachable from none of `roots` (orphans). */
export function findUnreachable(
  roots: string[],
  nodes: GraphNode[],
  edges: GraphEdge[],
): string[] {
  const ids = new Set(nodes.map((n) => n.id));
  const adj = adjacency(ids, edges);
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const r of roots) {
    if (ids.has(r) && !seen.has(r)) {
      seen.add(r);
      queue.push(r);
    }
  }
  while (queue.length) {
    const n = queue.shift()!;
    for (const m of adj.get(n) ?? []) {
      if (!seen.has(m)) {
        seen.add(m);
        queue.push(m);
      }
    }
  }
  return [...ids].filter((id) => !seen.has(id));
}

/**
 * Longest path length (in edges) reachable from `roots`. Returns `Infinity`
 * if a cycle is reachable — callers should run {@link detectCycles} first and
 * only trust this on a DAG. Used for the delegation depth cap.
 */
export function maxDepth(roots: string[], nodes: GraphNode[], edges: GraphEdge[]): number {
  const ids = new Set(nodes.map((n) => n.id));
  const adj = adjacency(ids, edges);
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const depth = (node: string): number => {
    const cached = memo.get(node);
    if (cached !== undefined) return cached;
    if (visiting.has(node)) return Infinity; // cycle guard
    visiting.add(node);
    let best = 0;
    for (const m of adj.get(node) ?? []) {
      best = Math.max(best, 1 + depth(m));
    }
    visiting.delete(node);
    memo.set(node, best);
    return best;
  };

  let best = 0;
  for (const r of roots) if (ids.has(r)) best = Math.max(best, depth(r));
  return best;
}
