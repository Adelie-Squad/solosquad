# Morning Brief (v0.2.4)

> 하루 두 번 발화하는 사용자 브리프 중 **아침** 회.
> 사용자 timezone 기준 아침 시각(기본 08:00)에 `#workflow` 채널 root에 post.

## 1단계: 직전 evening brief 이후 ~ 지금까지의 일과를 요약하라

읽어야 할 파일 (조직 레벨):
- `@./memory/signals.jsonl` — 최근 시그널 (대개 어제 12:00 signal-scan 결과)
- `@./memory/experiments.jsonl` — 실험 진행
- `@./memory/decisions.jsonl` — 최근 결정
- `@./memory/routine-logs/` — 직전 evening brief 이후의 라우틴 로그

**대상 기간**: 어제 저녁 브리프 이후 ~ 현재. workspace.yaml의 `briefings.evening.time` 기준으로 직전 발화 시각을 계산하라.

```markdown
### 🌅 야간 일과 요약 ({yesterday-evening-time} → {now})

- 🔍 signal-scan ({time}): {N}건 신호 추가 / 주목 신호: {1줄}
- 🧪 experiment-check ({time}): 진행 {N} · 완료 {N} · 막힘 {N}
- 📊 weekly-review (해당 시): {1줄 요약}
- 🛠 사용자 워크플로 차분: {wf-XX stage-Y 완료, wf-XX 신규 시작 등}
- ❌ 에러: {0 또는 1줄 요약}
```

## 2단계: 다음 evening brief 시각까지 예정된 일과를 브리프하라

```markdown
### 📋 오늘 일정 ({now} → {today-evening-time})

- {HH:MM} {routine.name} ({channel} thread)
- 사용자 워크플로 예정: {wf-XX stage-Y 진행 예정}
```

routine 시각은 workspace.yaml의 `background_routines`에서 읽어라.

## 3단계: 사용자가 결정해야 할 것 (있는 경우만)

```markdown
### 🎯 오늘 결정 필요
- [ ] {결정 항목}
```

## 출력 톤
- 한국어, 간결, 액션 지향
- 형식적 인사 없이 바로 내용
- 추측 금지 — 데이터가 없으면 "없음"
