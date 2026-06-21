import type { UserYaml } from "../bot/user-registry.js";
import { deriveChannelNames } from "../bot/user-registry.js";
import { CRONS } from "./crons.js";
import { timeToDailyCron } from "./crons.js";

/**
 * v1.3.3 §B / v1.3.4 §F2 — expand per-user brief registrations. Pure (inputs
 * injected) so it is unit-testable.
 *
 * v1.3.4 correction: there is no org-common "#workflow" brief. **Every** user
 * receives the personalizable built-ins (the `user-brief` crons — morning/
 * evening) in their own `works-<handle>` channel. `timezone` and the `crons`
 * block are per-user *overrides* (tz / time / per-brief enable), not an opt-in
 * gate. A brief is only skipped when explicitly disabled or when no default
 * time is supplied (a disabled workspace brief omits its time).
 */

export interface ResolvedUserCron {
  orgSlug: string;
  handle: string;
  cronId: string;
  name: string;
  emoji: string;
  expr: string;
  timezone: string;
  /** Target channel — the user's own works-<handle>. */
  channel: string;
}

export interface UserCronDefaults {
  tz: string;
  /** Default brief times keyed by cron id. */
  times: Record<string, string>;
}

/** Built-in crons eligible for per-user personalization (the user-facing briefs). */
function personalizable(): { id: string; name: string; emoji: string }[] {
  return CRONS.filter((c) => c.kind === "user-brief").map((c) => ({ id: c.id, name: c.name, emoji: c.emoji }));
}

export function resolveUserCrons(
  orgs: { slug: string; users: UserYaml[] }[],
  defaults: UserCronDefaults,
): ResolvedUserCron[] {
  const out: ResolvedUserCron[] = [];
  const briefs = personalizable();
  for (const org of orgs) {
    for (const u of org.users) {
      const tz = u.timezone || defaults.tz;
      const channel = deriveChannelNames(u.handle).works;
      for (const b of briefs) {
        const setting = u.crons?.[b.id];
        // If the user has a crons block but didn't list this brief, still
        // personalize it (opting in personalizes all briefs) unless explicitly
        // disabled. enabled defaults to true.
        if (setting?.enabled === false) continue;
        const time = setting?.time || defaults.times[b.id];
        if (!time) continue;
        out.push({
          orgSlug: org.slug,
          handle: u.handle,
          cronId: b.id,
          name: b.name,
          emoji: b.emoji,
          expr: timeToDailyCron(time),
          timezone: tz,
          channel,
        });
      }
    }
  }
  return out;
}
