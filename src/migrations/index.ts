import type { Migration } from "./types.js";
import { migration as v11xToV120 } from "./scripts/1.1.x-to-1.2.0.js";
import { migration as v120ToV121 } from "./scripts/1.2.0-to-1.2.1.js";
import { versionMatches } from "./detect.js";

/**
 * Migration registry — ordered list. Runner picks scripts whose `from`
 * matches the current workspace version, then chains forward until the
 * target version is reached.
 */
export const MIGRATIONS: Migration[] = [
  v11xToV120,
  v120ToV121,
];

/**
 * Given a source version and a target version, return the sequence of
 * migrations that walk from source to target.
 */
export function resolveChain(source: string, target: string): Migration[] {
  if (source === target) return [];
  const chain: Migration[] = [];
  let current = source;
  let guard = 0;
  while (current !== target) {
    guard++;
    if (guard > MIGRATIONS.length + 1) {
      throw new Error(
        `No migration path from ${source} to ${target} (stuck at ${current})`
      );
    }
    const next = MIGRATIONS.find((m) => versionMatches(m.from, current));
    if (!next) {
      throw new Error(`No migration found for source version ${current}`);
    }
    chain.push(next);
    current = next.to;
    if (current === target) break;
  }
  return chain;
}
