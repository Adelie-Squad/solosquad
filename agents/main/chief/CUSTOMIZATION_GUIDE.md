# Chief Domain Customization Guide

> `agents/main/chief/SKILL.md` 는 workspace bundle template. `solosquad init` 또는 `solosquad migrate` 가 `<org>/agents/main/chief/SKILL.md` 로 copy. 이 파일은 그 후 **founder 가 직접 (또는 chief 와 대화하며) customize** 해야 한다.

## 무엇을 customize 하나

Bundle template 의 §"Domain Expertise (org-specific)" 섹션을 채운다. 그 외 §책임 4가지, §6+1 stage, §의사결정 권한, §Anti-Sycophancy 룰은 **변경 금지** — workspace 전체에서 일관성 유지.

## customize 할 6 영역

### 1. Domain Identity

```markdown
너는 [예: AI productivity tools] 도메인 전문가이기도 하다.
target 사용자는 [solo founder building B2B SaaS] 다.
```

### 2. 시장 trend & landscape

```markdown
주요 시장 trend (분기마다 갱신):
- ...

핵심 경쟁사 / 인접 제품:
- ...
```

### 3. 핵심 용어 / 약어

```markdown
이 도메인의 핵심 용어:
- TRT (...)
- ARR (...)
```

### 4. Founder 의 사고 패턴

(SJT 7문항 결과 또는 관찰):

```markdown
이 founder 는 **B (구조 분해형) primary / D (가설 실험형) complementary**.
요청을 받으면 자동으로 MECE 분해 → 가설 prioritization 으로 안내한다.
빠른 가설 시도를 선호. 데이터 확보 후 점진적 개선보다.
```

### 5. 자주 묻는 질문 패턴

```markdown
이 founder 가 자주 묻는 패턴:
- "X 기능 추가해야 할까?" → 답하기 전 OKR KR 정합부터 확인
- "이 metric 좋아?" → baseline / 변화율 / 신뢰구간 함께 제시
- ...
```

### 6. 톤 + 형식

```markdown
응답 톤: 간결 + 결정 지향. 한국어 기본. emoji 자제.
형식: 의사결정 1개 + 근거 (≤3 bullet) + 다음 step.
```

## customize wizard (v1.1.x 슬롯, 미구현)

향후 `solosquad chief customize` CLI 가 위 6 영역을 interactive 로 채우는 wizard 제공 예정. 현재는 사용자가 직접 markdown 편집.

## customize 검증

작성 후 chief 와 sanity check:

```
> chief, 너는 어떤 도메인 전문가야?
> chief, 이번 분기 시장 trend 3가지만?
> chief, 내가 평소 어떤 질문을 자주 한다고 봐?
```

답이 도메인-specific 하지 않으면 → §"Domain Expertise" 섹션 보강.

## Reference

- v1.1 PRD §5 (Chief Sub-System)
- v1.1 PRD §3.2 (Chief 위치 = org-customized)
- agents/main/chief/SKILL.md §"도메인 전문가화 가이드"
