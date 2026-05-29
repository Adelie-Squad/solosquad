import type { Migration } from "./types.js";
import { migration as v01xToV020 } from "./scripts/0.1.x-to-0.2.0.js";
import { migration as v020ToV021 } from "./scripts/0.2.0-to-0.2.1.js";
import { migration as v021ToV024 } from "./scripts/0.2.1-to-0.2.4.js";
import { migration as v024ToV030 } from "./scripts/0.2.4-to-0.3.0.js";
import { migration as v030ToV040 } from "./scripts/0.3.0-to-0.4.0.js";
import { migration as v040ToV050 } from "./scripts/0.4.0-to-0.5.0.js";
import { migration as v050ToV060 } from "./scripts/0.5.0-to-0.6.0.js";
import { migration as v060ToV070 } from "./scripts/0.6.0-to-0.7.0.js";
import { migration as v070ToV080 } from "./scripts/0.7.0-to-0.8.0.js";
import { migration as v080ToV081 } from "./scripts/0.8.0-to-0.8.1.js";
import { migration as v081ToV082 } from "./scripts/0.8.1-to-0.8.2.js";
import { migration as v082ToV083 } from "./scripts/0.8.2-to-0.8.3.js";
import { migration as v083ToV084 } from "./scripts/0.8.3-to-0.8.4.js";
import { migration as v084ToV085 } from "./scripts/0.8.4-to-0.8.5.js";
import { migration as v085ToV086 } from "./scripts/0.8.5-to-0.8.6.js";
import { migration as v086ToV087 } from "./scripts/0.8.6-to-0.8.7.js";
import { migration as v087ToV091 } from "./scripts/0.8.7-to-0.9.1.js";
import { migration as v091ToV092 } from "./scripts/0.9.1-to-0.9.2.js";
import { migration as v092ToV100 } from "./scripts/0.9.2-to-1.0.0.js";
import { migration as v100ToV101 } from "./scripts/1.0.0-to-1.0.1.js";
import { migration as v101ToV102 } from "./scripts/1.0.1-to-1.0.2.js";
import { migration as v102ToV103 } from "./scripts/1.0.2-to-1.0.3.js";
import { migration as v103ToV104 } from "./scripts/1.0.3-to-1.0.4.js";
import { migration as v104ToV110 } from "./scripts/1.0.2-to-1.1.0.js";
import { migration as v110ToV126 } from "./scripts/1.1.0-to-1.2.6.js";
import { migration as v123ToV126 } from "./scripts/1.2.3-to-1.2.6.js";
import { migration as v126ToV128 } from "./scripts/1.2.6-to-1.2.8.js";
import { migration as v127ToV128 } from "./scripts/1.2.7-to-1.2.8.js";
import { versionMatches } from "./detect.js";

/**
 * Migration registry — ordered list. Runner picks scripts whose `from`
 * matches the current workspace version, then chains forward until the
 * target version is reached.
 *
 * v0.7.0 → v0.8.0 → v0.8.1 migrations live on sibling branches
 * (`feat/v0.8.0-multiuser-messenger`, `feat/v0.8.1-security-lifecycle-pair`)
 * and land here at merge time. The v0.8.2 step depends on v0.8.1 having
 * already bumped `workspace.yaml.version` to `0.8.1`.
 */
export const MIGRATIONS: Migration[] = [
  v01xToV020,
  v020ToV021,
  v021ToV024,
  v024ToV030,
  v030ToV040,
  v040ToV050,
  v050ToV060,
  v060ToV070,
  v070ToV080,
  v080ToV081,
  v081ToV082,
  v082ToV083,
  v083ToV084,
  v084ToV085,
  v085ToV086,
  v086ToV087,
  v087ToV091,
  v091ToV092,
  v092ToV100,
  v100ToV101,
  v101ToV102,
  v102ToV103,
  v103ToV104,
  v104ToV110,
  v110ToV126,
  v123ToV126,
  v126ToV128,
  v127ToV128,
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
