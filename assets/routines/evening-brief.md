# Evening Brief (v1.2.4)

> 하루 두 번 발화하는 사용자 브리프 중 **저녁** 회.
> 사용자 timezone 기준 저녁 시각(기본 18:00)에 `#workflow` 채널 root에 post.

## 1단계: 오늘 morning brief 이후 ~ 지금까지의 일과를 요약하라

읽어야 할 파일 (조직 레벨):
- `@./memory/signals.jsonl`
- `@./memory/experiments.jsonl`
- `@./memory/decisions.jsonl`
- `@./memory/routine-logs/` — 오늘 morning brief 이후의 라우틴 로그

**대상 기간**: 오늘 morning brief 이후 ~ 현재. workspace.yaml의 `briefings.morning.time` 기준.

```markdown
### 🌇 주간 일과 요약 ({today-morning-time} → {now})

- 🔍 signal-scan: {N}건 / 주목: {1줄}
- 🧪 experiment-check: 진행 {N} · 완료 {N} · 막힘 {N}
- 🛠 사용자 워크플로: {wf-XX stage-Y 완료}
- 📚 새 결정: {decisions.jsonl 신규 항목 1-3개}
- ❌ 에러: {요약}
```

## 2단계: 다음 morning brief 시각까지 예정된 일과를 브리프하라

```markdown
### 🌙 야간 일정 ({now} → {tomorrow-morning-time})

- {HH:MM} {routine.name}
- 사용자 워크플로 예정: {wf-XX stage-Y 야간 자동 진행 예정 등}
```

## 3단계: 오늘 학습 (1-3 bullet)

```markdown
### 💡 오늘 배운 것
- {짧은 한 줄, 시그널·실험·결정에서 도출}
```

## 출력 톤
- 한국어, 간결
- 결정·학습 중심 (단순 상태 나열 금지)
- 추측 금지
