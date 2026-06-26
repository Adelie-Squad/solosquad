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
import { migration as v128ToV129 } from "./scripts/1.2.8-to-1.2.9.js";
import { migration as v129ToV132 } from "./scripts/1.2.9-to-1.3.2.js";
import { migration as v132ToV133 } from "./scripts/1.3.2-to-1.3.3.js";
import { migration as v133ToV134 } from "./scripts/1.3.3-to-1.3.4.js";
import { migration as v134ToV135 } from "./scripts/1.3.4-to-1.3.5.js";
import { migration as v135ToV136 } from "./scripts/1.3.5-to-1.3.6.js";
import { migration as v136ToV137 } from "./scripts/1.3.6-to-1.3.7.js";
import { migration as v137ToV138 } from "./scripts/1.3.7-to-1.3.8.js";
import { migration as v138ToV139 } from "./scripts/1.3.8-to-1.3.9.js";
import { migration as v139ToV1310 } from "./scripts/1.3.9-to-1.3.10.js";
import { migration as v1310ToV1311 } from "./scripts/1.3.10-to-1.3.11.js";
import { migration as v1311ToV140 } from "./scripts/1.3.11-to-1.4.0.js";
import { migration as v140ToV141 } from "./scripts/1.4.0-to-1.4.1.js";
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
  v128ToV129,
  v129ToV132,
  v132ToV133,
  v133ToV134,
  v134ToV135,
  v135ToV136,
  v136ToV137,
  v137ToV138,
  v138ToV139,
  v139ToV1310,
  v1310ToV1311,
  v1311ToV140,
  v140ToV141,
];

/**
 * Registry continuity guard. Every migration whose `to` is not the terminal
 * (`latest`) version must have a successor whose `from` matches that `to` —
 * otherwise the chain dead-ends mid-way and `migrate` throws "No migration
 * found for source version <to>" for every workspace stamped that version.
 *
 * This is exactly the v1.3.x footgun: the `1.2.8 → 1.2.9` step landed on
 * `1.2.9` but no migration declared `from: "1.2.9"`, so every upgraded
 * workspace dead-ended there. Returns the list of dead-end `to` versions
 * (empty = continuous chain). Exercised by
 * test/migration-registry-continuity.test.ts so a future release that forgets
 * its migration entry fails CI instead of users' upgrades.
 */
export function findRegistryGaps(latest: string): string[] {
  const gaps: string[] = [];
  for (const m of MIGRATIONS) {
    if (m.to === latest) continue;
    const hasSuccessor = MIGRATIONS.some((n) => versionMatches(n.from, m.to));
    if (!hasSuccessor) gaps.push(m.to);
  }
  return gaps;
}

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
