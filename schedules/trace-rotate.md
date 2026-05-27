# Trace Rotate (v1.1 schedule)

> 매일 1회 실행. `<org>/memory/` 의 jsonl 파일들 회전 + 아카이브.

## 대상 파일

| 파일 | 회전 임계값 | 아카이브 위치 |
|---|---|---|
| `chief-stage-events.jsonl` | 50MB 또는 7일 | `<org>/memory/archive/chief-stage-events-YYYY-MM-DD.jsonl.gz` |
| `agent-costs.jsonl` | 30MB 또는 14일 | `<org>/memory/archive/agent-costs-YYYY-MM-DD.jsonl.gz` |
| `leading-indicators.jsonl` | 회전 안 함 (영구) | — |
| `ledger/<task-id>.jsonl` | 완료된 task 30일 후 | `<org>/memory/archive/ledger/<task-id>.jsonl.gz` |

## 실행 절차

1. 각 jsonl 파일의 크기 + 가장 오래된 timestamp 확인
2. 임계값 초과 시 gzip → archive 폴더로 이동
3. archive 90일 이상은 삭제 (사용자 ack 후)
4. 결과 요약을 `<org>/memory/routine-logs/trace-rotate-YYYY-MM-DD.md` 에 기록

## Reference

- v1.1 PRD §12.2 (신규 schedule 3건)
