/**
 * v1.3.2 §9.1 — domain-agnostic validation core.
 *
 * The five managers (skill · agent · workflow · goal · schedule) all emit the
 * same shape: an `{ ok, errors[], warnings[] }` result over findings of the
 * form `{ code, message, field? }`, accumulated imperatively. Before this
 * module each validator hand-rolled two arrays and the `ok: errors.length===0`
 * return. `Findings` centralizes that idiom so a manager only writes its rules;
 * `runRules` offers a declarative alternative for rule-set–style validators.
 *
 * Pure — no fs, no domain types. Generic over a finding type `F` so each
 * domain keeps its own extra fields (e.g. workflow's `stage`, schedule's `id`).
 */

export interface BaseFinding {
  code: string;
  message: string;
  field?: string;
}

export interface ValidationResult<F extends BaseFinding = BaseFinding> {
  ok: boolean;
  errors: F[];
  warnings: F[];
}

/**
 * Mutable accumulator. Push findings as you discover them, then call
 * `.result()`. The `*If` helpers fold the ubiquitous
 * `if (cond) errors.push(...)` pattern into one call so a validator body reads
 * as a flat list of rules.
 */
export class Findings<F extends BaseFinding = BaseFinding> {
  readonly errors: F[] = [];
  readonly warnings: F[] = [];

  error(finding: F): this {
    this.errors.push(finding);
    return this;
  }

  warn(finding: F): this {
    this.warnings.push(finding);
    return this;
  }

  /** Push an error only when `condition` holds. Returns `condition` so callers
   *  can short-circuit further checks: `if (f.errorIf(!id, {...})) return f.result();` */
  errorIf(condition: boolean, finding: F): boolean {
    if (condition) this.errors.push(finding);
    return condition;
  }

  warnIf(condition: boolean, finding: F): boolean {
    if (condition) this.warnings.push(finding);
    return condition;
  }

  /** Fold another result's findings into this collector (e.g. a sub-validator). */
  merge(other: ValidationResult<F>): this {
    this.errors.push(...other.errors);
    this.warnings.push(...other.warnings);
    return this;
  }

  result(): ValidationResult<F> {
    return { ok: this.errors.length === 0, errors: this.errors, warnings: this.warnings };
  }
}

export type Severity = "error" | "warning";

/** A rule maps a subject to zero or more severity-tagged findings. */
export type Rule<S, F extends BaseFinding = BaseFinding> = (
  subject: S,
) => Array<{ severity: Severity; finding: F }> | { severity: Severity; finding: F } | null | undefined;

/** Declarative runner: apply every rule to `subject`, collect into one result. */
export function runRules<S, F extends BaseFinding>(subject: S, rules: Rule<S, F>[]): ValidationResult<F> {
  const acc = new Findings<F>();
  for (const rule of rules) {
    const out = rule(subject);
    if (!out) continue;
    const list = Array.isArray(out) ? out : [out];
    for (const { severity, finding } of list) {
      if (severity === "error") acc.error(finding);
      else acc.warn(finding);
    }
  }
  return acc.result();
}
