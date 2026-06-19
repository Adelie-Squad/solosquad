import type { UserYaml } from "../bot/user-registry.js";
import { deriveChannelNames } from "../bot/user-registry.js";
import { CRONS } from "./crons.js";
import { timeToDailyCron } from "./crons.js";

/**
 * v1.3.3 §B (cron 개인화) — expand opt-in user cron settings into concrete
 * per-user brief registrations. Pure (inputs injected) so it is unit-testable.
 *
 * A user is "opted in" when their yaml carries a `crons` block or a `timezone`.
 * For each personalizable built-in (the `user-brief` crons — morning/evening),
 * an opted-in user gets a registration firing at their own time (or the
 * workspace default) in their own timezone, delivered to `works-<handle>`.
 * Org-level #workflow briefs are unaffected (additive).
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

function isOptedIn(u: UserYaml): boolean {
  return !!u.timezone || (!!u.crons && Object.keys(u.crons).length > 0);
}

export function resolveUserCrons(
  orgs: { slug: string; users: UserYaml[] }[],
  defaults: UserCronDefaults,
): ResolvedUserCron[] {
  const out: ResolvedUserCron[] = [];
  const briefs = personalizable();
  for (const org of orgs) {
    for (const u of org.users) {
      if (!isOptedIn(u)) continue;
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
