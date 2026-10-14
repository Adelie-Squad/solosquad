import { useOutletContext } from 'react-router-dom';
import type { Space } from './data/dummy';
import type { Job } from './hooks/useLiveActivity';

export interface WorkspaceContext {
  jobs: Job[];
  space: Space;
}

export const useWorkspace = () => useOutletContext<WorkspaceContext>();

/** 커맨드 바 → 홈 대화창으로 프롬프트를 넘길 때 쓰는 location.state 형태 */
export interface PromptHandoff {
  prompt: string;
}
