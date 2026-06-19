# System Housekeeping (v0.8.5 unified)

매일 00:00 (workspace timezone)에 자동 실행되는 백그라운드 인프라 루틴.
사용자에게 알림을 보내지 않는다. LLM을 호출하지 않는다.

## 동작

두 결정적 작업을 순차 실행 (각 단계는 try/catch로 격리 — 한쪽 실패가 다른 쪽을 막지 않음):

### 1. Archive Rotate — v0.6 §4

`src/memory/archive-rotate.ts`의 `rotateArchive()` 호출.

- `<org>/memory/*.jsonl` 및 `<org>/memory/routine-logs/*.jsonl` 스캔
- 8일 이상 된 행을 `archive.sqlite` (FTS5 virtual table)로 이전
- 원본 JSONL에서 해당 행 삭제 (hot tier 크기 유지)
- `workspace.yaml.archive.retention_days` (기본 365) 초과 행은 SQLite에서 삭제
- `archive.compress_before_delete: true` 인 경우 `archive-<YYYY-MM>.zst`로 분기 보관 후 삭제

인덱싱 대상 `event_type`: `routine_log` (기본) · `route_hit` · `route_miss` ·
`author_turn` · `spawn_decision`.

### 2. Log Rotate — v0.8.3 §5.3

`src/util/logger.ts`의 `rotateLogs()` 호출.

- `<workspace>/.solosquad/logs/` 스캔
- `solosquad-YYYY-MM-DD.log` 패턴 중 14일 이전 파일 삭제
- 다음 날짜 파일은 logger가 첫 호출 시 자동 생성

## 통합 사유 (v0.8.5)

이전엔 `archive-rotate` (00:00) + `log-rotate` (00:30)로 분리됐으나, 둘 다:
- 자정 직후 idle 시 동작하는 housekeeping
- silent (사용자 알림 X)
- 결정적 (LLM 호출 X)
- 멱등 (재실행 안전)

따라서 cron 한 항목, 표시 1행으로 통합해 사용자 인지 마찰 ↓. try/catch
격리로 한쪽 실패 격리는 유지.

## 보고

본 routine은 사용자에게 알림을 전송하지 않는다. 운영 확인:

```
solosquad memory stats --disk            # archive 측정
solosquad memory search "<query>"        # FTS5 검색
solosquad logs --tail 100                # 로그 tail
solosquad logs --level warn --tail 50    # warn 이상만
```

## 실패 시 동작

- Archive 단계: JSONL 파싱 실패는 행 단위 skip. SQLite open 실패는 archive
  단계 중단(다음 cycle 재시도), 그러나 log 단계는 계속 진행.
- Log 단계: 디렉토리 부재 시 no-op. 파일 권한 오류는 해당 파일만 skip.

LLM이 본 prompt를 호출하지 않는다 — 두 결정적 함수가 `src/scheduler/index.ts`
의 inline dispatch에서 직접 실행한다.
