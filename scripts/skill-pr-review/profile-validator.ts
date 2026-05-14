/**
 * v0.6 S6.B §11.5 — agent-profile.yaml schema validation for PR review.
 *
 * Re-uses the production parser/merger (`src/util/agent-profile.ts`) so the
 * PR bot's idea of "valid" exactly matches what spawn-assembler will accept
 * at runtime. The bot's job is to *surface* problems with a clear message,
 * not re-implement the schema.
 *
 * Two PR-only checks layered on top of the runtime merger:
 *
 *   - `schema_version` MUST equal `AGENT_PROFILE_SCHEMA_VERSION` (1 in v0.6).
 *     The merger downgrades-on-mismatch (returns empty); for a PR we want a
 *     hard error so a future v2 file is not silently ignored on main.
 *
 *   - `defaults < agent` narrowing invariant — the merger warns and snaps to
 *     parent when an agent budget is wider than defaults. In CI we promote
 *     that warning to an error so the wider override never lands in main.
 */
import yaml from "js-yaml";
import {
  AGENT_PROFILE_SCHEMA_VERSION,
  mergeProfiles,
  type AgentProfileYaml,
  type AgentProfileMerged,
} from "../../src/util/agent-profile.js";

export interface ProfileValidationIssue {
  severity: "error" | "warning";
  field?: string;
  message: string;
}

export interface ProfileValidationResult {
  ok: boolean;
  issues: ProfileValidationIssue[];
}

function emptyMerged(): AgentProfileMerged {
  return {
    defaults: {},
    agents: {},
    warnings: [],
    schemaVersion: AGENT_PROFILE_SCHEMA_VERSION,
  };
}

export function validateProfileYaml(raw: string): ProfileValidationResult {
  const issues: ProfileValidationIssue[] = [];

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    issues.push({
      severity: "error",
      message: `invalid YAML: ${(e as Error).message}`,
    });
    return { ok: false, issues };
  }

  if (parsed === null || parsed === undefined) {
    // Empty file. Treat as valid no-op (defaults: nothing).
    return { ok: true, issues };
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    issues.push({
      severity: "error",
      message: "agent-profile root must be a YAML mapping",
    });
    return { ok: false, issues };
  }

  const profile = parsed as AgentProfileYaml;

  // schema_version hard-check.
  if (profile.schema_version === undefined) {
    issues.push({
      severity: "warning",
      field: "schema_version",
      message: `schema_version field missing — expected ${AGENT_PROFILE_SCHEMA_VERSION}. Re-run \`solosquad migrate\` to add it.`,
    });
  } else if (profile.schema_version !== AGENT_PROFILE_SCHEMA_VERSION) {
    issues.push({
      severity: "error",
      field: "schema_version",
      message: `schema_version=${profile.schema_version} is not supported (expected ${AGENT_PROFILE_SCHEMA_VERSION})`,
    });
  }

  // Defaults section must be a mapping if present.
  if (profile.defaults !== undefined) {
    if (typeof profile.defaults !== "object" || Array.isArray(profile.defaults)) {
      issues.push({
        severity: "error",
        field: "defaults",
        message: "defaults must be a YAML mapping",
      });
    }
  }

  // Run the production merger and promote its narrowing warnings to errors.
  // The merger emits one warning per agent.budget.<key> that violates the
  // narrower-only rule; we re-emit them as errors so the PR fails.
  try {
    const merged = mergeProfiles(emptyMerged(), profile, "PR file");
    for (const w of merged.warnings) {
      // The merger surfaces budget-narrowing warnings prefixed with
      // "agent-profile:". Keep the same prefix in our output for grep-ability.
      if (w.includes("exceeds parent cap")) {
        issues.push({
          severity: "error",
          field: "budget",
          message: w,
        });
      } else {
        issues.push({
          severity: "warning",
          message: w,
        });
      }
    }
  } catch (e) {
    issues.push({
      severity: "error",
      message: `profile merge failed: ${(e as Error).message}`,
    });
  }

  const ok = !issues.some((i) => i.severity === "error");
  return { ok, issues };
}
