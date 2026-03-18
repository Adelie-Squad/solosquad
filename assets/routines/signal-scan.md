# Signal Scan 루틴

이 제품과 관련된 시그널을 탐지하라.

## 읽어야 할 파일
- @./product/brief.md (제품 정의)
- @./memory/hypotheses.jsonl (현재 가설)
- @./memory/signals.jsonl (기존 시그널)

## 탐지 대상
1. 경쟁 제품 변화
2. 타깃 고객군 행동 변화
3. 기술 트렌드 변화
4. 규제/정책 변화

## 출력 형식

### 오늘의 시그널
각 시그널마다:
- **출처**: (어디서 발견)
- **유형**: competitor / customer / tech / policy
- **내용**: (한 줄 요약)
- **관련도**: high / medium / low
- **권장 행동**: (무엇을 해야 하는지)

### signals.jsonl 추가 항목
```json
{"date":"YYYY-MM-DD","source":"...","type":"...","content":"...","relevance":"...","action":"..."}
```

시그널이 없으면 "오늘은 주목할 시그널 없음"으로 보고.
