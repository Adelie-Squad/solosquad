import fs from "fs";
import path from "path";
import { LEDGER_REL_PATH } from "../analyze/ledger.js";

/**
 * v0.6 §2.6 — onboarding 두 트랙 분기.
 *
 * v0.5 ledger(`<workspace>/<org>/.solosquad/analysis-ledger.yaml`)가 어느
 * 한 org에라도 존재하면 *기존 v0.5 사용자*. 없으면 *신규 사용자*. ledger는
 * v0.5 S4 `analyze repo` 산출물 — 사용자가 v0.5를 한 번이라도 운용했다는
 * 결정적 시그널이다(memory/author-costs.jsonl은 author 루프를 한 번이라도
 * 돈 사용자에 한정되므로 너무 좁다).
 *
 * Pure file-system check: no LLM, no network. Cross-platform via `path.join`.
 */
export function detectV05Usage(workspace: string): boolean {
  if (!fs.existsSync(workspace)) return false;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(workspace, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    const ledger = path.join(workspace, entry.name, LEDGER_REL_PATH);
    if (fs.existsSync(ledger)) return true;
  }
  return false;
}
