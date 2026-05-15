# Log Rotate (v0.8.3 daily log retention)

매일 00:30 (workspace timezone)에 자동 실행되는 백그라운드 루틴.

## 동작

1. `<workspace>/.solosquad/logs/` 디렉토리를 스캔
2. 파일명 패턴 `solosquad-YYYY-MM-DD.log` 중 14일 이전 파일 삭제
3. 다음 날짜 파일은 logger가 첫 호출 시 자동 생성 — 본 routine은 retention만 보장

## 설정

- 보존 기간(`retentionDays`): 14일 고정 (v0.8.3 §5.1). 향후 `workspace.yaml.logs.retention_days`로 노출 검토.
- 파일 출력 활성: `SOLOSQUAD_LOG_FILE=1` 환경변수 (기본 off)
- 로그 레벨: `SOLOSQUAD_LOG_LEVEL=error|warn|info|debug` (기본 info)
- 로그 포맷: `SOLOSQUAD_LOG_FORMAT=text|json` (기본 text, file에는 항상 json)

## 보고

본 routine은 **사용자에게 알림을 전송하지 않는다**. 결과 확인:

```
solosquad logs --tail 100               # 최근 100줄
solosquad logs --level warn --tail 50   # warn 이상만
solosquad logs --type costs --org main  # cost jsonl만
```

## 실패 시 동작

디렉토리 부재 (logger 파일 출력 활성화된 적 없음) → no-op.
파일 시스템 권한 오류 → 해당 파일만 skip, 나머지 진행.

이 prompt는 LLM이 호출하지 않는다 — `src/util/logger.ts`의 `rotateLogs()`
함수가 결정적으로 실행한다.
