/**
 * v0.5 §5.6 — token usage → USD conversion for the Author loop budget envelope.
 *
 * Anthropic 2026 list pricing (per MTok):
 *   opus-4-7      input $15.00   output $75.00
 *   sonnet-4-6    input  $3.00   output $15.00
 *   haiku-4-5     input  $0.80   output  $4.00
 *
 * Cache pricing follows the Anthropic standard:
 *   cache_creation_input_tokens — 1.25× base input
 *   cache_read_input_tokens     — 0.10× base input
 *
 * The Author loop calls `usdFromUsage` after each Claude API response and
 * appends the result to `<org>/memory/author-costs.jsonl` (see
 * `author-budget.ts`). The number is intentionally not rounded — callers
 * that want a display-ready string format upstream.
 */

export type CostModel = "opus-4-7" | "sonnet-4-6" | "haiku-4-5";

export interface UsageBreakdown {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

interface ModelRates {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
}

const RATES: Record<CostModel, ModelRates> = {
  "opus-4-7": { input: 15, output: 75 },
  "sonnet-4-6": { input: 3, output: 15 },
  "haiku-4-5": { input: 0.8, output: 4 },
};

const CACHE_CREATION_MULT = 1.25;
const CACHE_READ_MULT = 0.1;
const MTOK = 1_000_000;

export function usdFromUsage(usage: UsageBreakdown, model: CostModel): number {
  const rates = RATES[model];
  const baseInputPerToken = rates.input / MTOK;
  const baseOutputPerToken = rates.output / MTOK;

  const input = (usage.input_tokens ?? 0) * baseInputPerToken;
  const output = (usage.output_tokens ?? 0) * baseOutputPerToken;
  const cacheCreate =
    (usage.cache_creation_input_tokens ?? 0) * baseInputPerToken * CACHE_CREATION_MULT;
  const cacheRead =
    (usage.cache_read_input_tokens ?? 0) * baseInputPerToken * CACHE_READ_MULT;

  return input + output + cacheCreate + cacheRead;
}

/** Exposed for tests / diagnostics — list of supported model ids. */
export function supportedModels(): CostModel[] {
  return Object.keys(RATES) as CostModel[];
}
