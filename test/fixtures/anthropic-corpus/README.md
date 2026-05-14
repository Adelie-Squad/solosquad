# Anthropic-style SKILL.md fixtures

이 디렉토리의 파일들은 [`anthropics/skills`](https://github.com/anthropics/skills)
공개 레포의 SKILL.md 스타일을 모방한 **로컬 회귀 fixture** 입니다. v0.5 plan §11.4
외부 코퍼스 cross-validation의 *오프라인 fallback* — CI/오프라인 환경에서도 재현
가능하게 유지하기 위함입니다.

**용도:**
- v0.5 `skill-parser.ts`가 Anthropic 공식 포맷(`name` + `description`만 있는 minimal)을
  파싱하고 round-trip 시 byte-identical로 재출력하는지 확인
- SoloSquad 확장 필드(`triggers`, `inputs`, ...)가 부재할 때 fallback 동작 확인

**실제 `anthropics/skills` 코퍼스 fetch (선택):**
`SOLOSQUAD_FETCH_EXTERNAL_CORPUS=1` 환경 변수로 `validator-corpus.ts`가 실제 레포에서
SKILL.md를 끌어와 추가 검증합니다. fetched 코퍼스는 `test/.cache/anthropic-skills-<sha>/`에
캐시되어 재사용. 기본 테스트는 fetch 없이 본 fixture만 검사하므로 CI 결정성 유지.

각 fixture는 **수동 작성** — Anthropic 레포 본문 직접 복사 아님. 라이선스/저작권 안전.
