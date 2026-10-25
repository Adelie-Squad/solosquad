import type { Dispatch, SetStateAction } from 'react';
import { useOutletContext } from 'react-router-dom';
import type { CategoryId, LedgerEntry, Member, Space } from './data/dummy';
import type { Job, TokenTally } from './hooks/useLiveActivity';

export interface FinanceState {
  /** 지난 결산 엑셀을 올렸는지 — 올리기 전에는 이번 달 자동 기록만 보인다 */
  importedFile: string | null;
  /** 자동 기록 장부 — 확인 필요 건수가 사이드바 배지에 뜬다 */
  ledger: LedgerEntry[];
}

export interface WorkspaceContext {
  jobs: Job[];
  sessionTokens: TokenTally;
  space: Space;
  /** 지금 화면을 보고 있는 사람 — 설정의 '이 사람으로 보기'로 바뀐다 */
  viewer: Member;
  canAccess: (category: CategoryId) => boolean;
  finance: FinanceState;
  setFinance: Dispatch<SetStateAction<FinanceState>>;
}

export const useWorkspace = () => useOutletContext<WorkspaceContext>();

/** 마스터는 모든 카테고리, 팀원은 열어 준 카테고리만 */
export function accessFor(member: Member) {
  return (category: CategoryId) => member.master || member.categories.includes(category);
}

/** 커맨드 바 → 홈 대화창으로 프롬프트를 넘길 때 쓰는 location.state 형태 */
export interface PromptHandoff {
  prompt: string;
}
