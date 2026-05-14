# Archive Rotate (v0.6 nightly cold-archive)

매일 00:00 (workspace timezone)에 자동 실행되는 백그라운드 루틴.

## 동작

1. `<org>/memory/*.jsonl` 및 `<org>/memory/routine-logs/*.jsonl` 스캔
2. 8일 이상 된 행을 `archive.sqlite` (FTS5 virtual table)로 이전
3. 원본 JSONL에서 해당 행 삭제 (hot tier 크기 유지)
4. `workspace.yaml.archive.retention_days` (기본 365) 초과 행은 SQLite에서 삭제
5. `workspace.yaml.archive.compress_before_delete: true` 인 경우 `archive-<YYYY-MM>.zst`로 분기 보관 후 삭제

## 인덱싱 대상 (event_type)

- `routine_log` — 기본값. 기존 routine-logs/*.jsonl + signals/decisions/experiments
- `route_hit` — `agent-router.resolve()` 성공 — `<org>/memory/route-events.jsonl`
- `route_miss` — 라우터 미스 (§3.4 freq 자동 추천 입력)
- `author_turn` — author 루프 turn 로그
- `spawn_decision` — PM의 Task tool agent 선택 + 사유

## 보고

본 routine은 **사용자에게 알림을 전송하지 않는다**. 운영자가 통계를 보려면:

```
solosquad memory stats --disk
solosquad memory search "<query>"
```

## 실패 시 동작

JSONL 파일 한두 개 파싱 실패는 무시 (line skip). SQLite open 실패 시 전체 중단 + 다음 cycle 재시도.

이 prompt는 LLM이 호출하지 않는다 — `src/memory/archive-rotate.ts`의 `rotateArchive()` 함수가 결정적으로 실행한다.
