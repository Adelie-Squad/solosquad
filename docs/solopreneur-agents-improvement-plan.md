# Solo Founder Agents 개선 계획

> 이 문서는 초기 설계 참고용으로 보존됨. 최신 진행 상황은 [progress.md](./progress.md) 참조.

## 초기 개선 목표

기존 SKILL.md 기반 에이전트 시스템에 24/7 자동화 인프라를 추가하여
Discord 봇 + 스케줄러 + CLI 도구로 완전한 솔로프리너 비서 시스템 구축.

## 설계 원칙

1. **Claude Code Max 플랜 활용** — API 직접 호출 없이 `claude --print` CLI 기반
2. **제품별 격리** — 3-Layer 컨텍스트 아키텍처 (Universal → Product → Project)
3. **범용 배포** — 특정 서비스/오너명 하드코딩 없이, setup.py로 사용자별 맞춤 설정
4. **JSONL 메모리** — append 방식 + 루틴 자동 저장으로 피드백 루프 완성

## 구현 완료 항목

모든 항목 구현 완료. 상세 내용은 [progress.md](./progress.md) 참조.

1. Discord Bot + 에이전트 라우팅
2. Scheduler + 메모리 자동 저장
3. CLI Tools (new_project, status, run_routine)
4. Setup Wizard
5. Core Templates
6. Routine Prompts (5개)
7. Docker 배포
8. 서비스명 일반화
