# Experiment Check 루틴

진행 중인 실험의 상태를 점검하라.

## 읽어야 할 파일
- @./memory/hypotheses.jsonl (가설 목록)
- @./memory/experiments.jsonl (실험 기록)
- @./product/weekly-state.md (이번 주 포커스)

## 점검 항목
1. status=TESTING인 가설이 있는가?
2. 각 실험의 signal_strength는 얼마인가?
3. 충분한 데이터가 모였는가?
4. 피벗 또는 확정 판단이 가능한가?

## 출력 형식

### 실험 현황
| 가설 ID | 실험 방법 | signal_strength | 판단 |
|---------|----------|-----------------|------|
| H-001   | ...      | 0.7             | 유지 |

### 판단 기준
- signal_strength >= 0.7 → 유효한 신호, 다음 단계 진행
- 0.3 <= signal_strength < 0.7 → 추가 데이터 필요
- signal_strength < 0.3 → 약한 신호, 피벗 검토

### 권장 행동
(다음에 무엇을 해야 하는지)
