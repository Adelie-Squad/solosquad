import yaml from "js-yaml";
import { extractDescription } from "../bot/agents-builder.js";
import { normalizeLine } from "../util/platform.js";

/**
 * v0.5 S5 — shared frontmatter-backfill logic.
 *
 * Used by both the one-shot bundled-asset backfill (`scripts/backfill-bundled-
 * frontmatter.ts`) and the user-workspace migration (`scripts/0.4.0-to-0.5.0.ts`).
 * Centralized so the canonical keyword mapping has a single source of truth.
 *
 * The canonical map is the v0.4 `AGENT_ROUTES` constant (deleted in S2 commit
 * b1651d9). Reconstructed here per the v0.5 plan §10 so the migration can
 * reproduce keyword routing in the new frontmatter format.
 */

/**
 * Canonical keyword → agent mapping from the deleted `AGENT_ROUTES` map
 * (pre-S2 v0.4). Keys are `"<team>/<agent>"`.
 */
export const CANONICAL_KEYWORDS: Record<string, string[]> = {
  "strategy/pmf-planner": ["pmf", "시장 적합", "가설"],
  "strategy/feature-planner": ["기능 기획", "기능 추가", "스펙"],
  "strategy/policy-architect": ["정책", "약관"],
  "strategy/data-analyst": ["데이터 분석", "지표", "매출"],
  "strategy/business-strategist": ["사업 전략", "수익 모델", "비즈니스"],
  "strategy/idea-refiner": ["아이디어", "브레인스토밍"],
  "strategy/scope-estimator": ["일정", "견적", "스코프"],
  "growth/paid-marketer": ["광고", "퍼포먼스", "cpa"],
  "growth/gtm-strategist": ["마케팅", "gtm", "런칭"],
  "growth/content-writer": ["카피", "블로그", "글쓰기", "콘텐츠"],
  "growth/brand-marketer": ["브랜드", "브랜딩", "네이밍"],
  "experience/user-researcher": ["유저 리서치", "인터뷰", "설문", "페르소나"],
  "experience/desk-researcher": ["시장 조사", "경쟁사", "벤치마크"],
  "experience/ux-designer": ["ux", "와이어프레임", "사용성", "플로우"],
  "experience/ui-designer": ["ui", "디자인 시스템", "목업"],
  "engineering/creative-frontend": ["프론트", "프론트엔드", "랜딩"],
  "engineering/fde": ["프로토타입", "mvp", "빠르게 만들"],
  "engineering/architect": ["아키텍처", "설계", "시스템 구조"],
  "engineering/backend-developer": ["백엔드", "서버", "db"],
  "engineering/api-developer": ["api", "엔드포인트"],
  "engineering/data-collector": ["크롤링", "수집", "스크래핑"],
  "engineering/data-engineer": ["파이프라인", "etl"],
  "engineering/cloud-admin": ["배포", "인프라", "도커", "ci/cd"],
  "engineering/qa-engineer": ["테스트", "qa", "품질", "버그", "검증"],
  "engineering/security-engineer": [
    "보안 점검",
    "접근 제어",
    "보안",
    "시큐리티",
    "security",
    "취약점",
  ],
};

export interface BackfillInput {
  /** Agent folder name (== SKILL.md frontmatter `name`). */
  name: string;
  /** Parent team folder name. */
  team: string;
  /** Original SKILL.md body (frontmatter-free). */
  body: string;
  /** Keyword triggers — usually from CANONICAL_KEYWORDS. */
  keywords: string[];
}

/** Does `raw` already begin with YAML frontmatter? Used for idempotency. */
export function hasFrontmatter(raw: string): boolean {
  return normalizeLine(raw).startsWith("---\n");
}

/**
 * Build the frontmatter YAML block for a backfill target. Returns the inner
 * YAML text (without `---` fences). The caller wraps with fences and prepends
 * to the body.
 *
 * Field order matches `serializeFrontmatter()` in skill-parser.ts to keep the
 * round-trip stable: name, description, team, stateful, triggers.
 */
export function buildBackfillFrontmatter(input: BackfillInput): string {
  const description = extractDescription(input.body).slice(0, 200);
  const obj: Record<string, unknown> = {
    name: input.name,
    description,
    team: input.team,
    stateful: false,
    triggers: {
      keyword: input.keywords,
      explicit: true,
    },
  };
  return yaml.dump(obj, { lineWidth: -1 }).replace(/\n$/, "");
}
