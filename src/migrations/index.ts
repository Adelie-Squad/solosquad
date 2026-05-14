import type { Migration } from "./types.js";
import { migration as v01xToV020 } from "./scripts/0.1.x-to-0.2.0.js";
import { migration as v020ToV021 } from "./scripts/0.2.0-to-0.2.1.js";
import { migration as v021ToV024 } from "./scripts/0.2.1-to-0.2.4.js";
import { migration as v024ToV030 } from "./scripts/0.2.4-to-0.3.0.js";
import { migration as v030ToV040 } from "./scripts/0.3.0-to-0.4.0.js";
import { migration as v040ToV050 } from "./scripts/0.4.0-to-0.5.0.js";
import { versionMatches } from "./detect.js";

/**
 * Migration registry — ordered list. Runner picks scripts whose `from`
 * matches the current workspace version, then chains forward until the
 * target version is reached.
 */
export const MIGRATIONS: Migration[] = [
  v01xToV020,
  v020ToV021,
  v021ToV024,
  v024ToV030,
  v030ToV040,
  v040ToV050,
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
