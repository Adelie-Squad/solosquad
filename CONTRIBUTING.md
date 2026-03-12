# Contributing

기여해주셔서 감사합니다.

---

## 기여 가능한 영역

### 1. 에이전트 추가/개선

`agents/{team}/{agent}/SKILL.md` 파일을 생성하거나 수정한다.

**SKILL.md 필수 섹션:**
```markdown
# [Agent Name]

> 한 줄 설명

## Trigger
- 언제 이 에이전트가 활성화되는가

## Input
- 필수/선택 입력 항목

## Process
- 단계별 처리 로직

## Output
- 산출물 형식

## Quality Checklist
- 품질 검증 기준

## Handoff
- 다음 단계로 전달할 내용
```

새 에이전트를 추가한 경우, `src/bot.py`의 `AGENT_ROUTES`에 키워드 매핑도 추가해야 한다:
```python
AGENT_ROUTES = {
    "키워드": ("team", "agent-slug"),
    ...
}
```

### 2. 루틴 추가/수정

`routines/{routine-id}.md` 파일을 생성하거나 수정한다.

루틴은 다음 구조를 따른다:
```markdown
# 루틴 이름

설명

## 읽어야 할 파일
- @./product/brief.md
- @./memory/experiments.jsonl

## 출력 형식
(구체적 형식 정의)
```

새 루틴을 추가한 경우:
1. `src/scheduler.py`의 `ROUTINES` 리스트에 등록
2. `cli/run_routine.py`의 `ROUTINES` 리스트에도 동일하게 등록
3. JSONL 메모리에 자동 저장할 대상이 있으면 `memory_targets` 지정

### 3. CLI 도구

`cli/` 디렉토리에 새 CLI 도구를 추가한다.

규칙:
- `rich` 라이브러리로 터미널 UI 구성
- `core/products.json`에서 제품 목록 로드
- `REPOS_BASE_PATH` 환경변수로 프로젝트 경로 결정
- `argparse`로 CLI 인자 처리

### 4. PRD 템플릿

`templates/prd-{type}.md` 파일을 생성한다.

템플릿 변수: `{{variable_name}}` 형식.

### 5. 문서

`docs/` 디렉토리에 설계 문서, 가이드 등을 추가한다.

---

## 코드 스타일

### Python

- Python 3.10+ 문법 사용
- 비동기 코드: `asyncio` + `async/await`
- Claude Code 호출: `claude --print` (stdin으로 프롬프트 전달)
- 설정 로드: `python-dotenv` + `.env` 파일
- 제품 정보: `core/products.json` (setup.py가 자동 생성)

### SKILL.md 작성 원칙

1. **명확한 트리거**: 언제 활성화되는지 구체적으로
2. **구조화된 프로세스**: 단계별로 명확하게
3. **실행 가능한 산출물**: 바로 활용 가능한 형태
4. **품질 체크리스트**: 자가 검증 가능하도록

### 네이밍 규칙

- 에이전트: `lowercase-with-hyphen` (예: `user-researcher`)
- 루틴: `lowercase-with-hyphen.md` (예: `signal-scan.md`)
- CLI: `lowercase_with_underscore.py` (예: `run_routine.py`)
- 템플릿: `prd-{type}.md` (예: `prd-pmf.md`)

---

## Pull Request 가이드

### PR 제목 형식
```
[Agent] Add branding agent
[Routine] Add competitor-watch routine
[CLI] Add export command
[Bot] Improve agent routing accuracy
[Fix] Fix scheduler memory append
[Docs] Update installation guide
```

### PR 설명 포함 사항
- 변경 이유
- 변경 내용 요약
- 테스트 방법 (해당 시)

---

## 이슈 리포트

### 버그 리포트
```
**환경**
- Claude Code 버전:
- OS:
- Python 버전:

**재현 단계**
1.
2.

**예상 동작**

**실제 동작**
```

### 기능 제안
```
**문제/필요성**

**제안하는 솔루션**

**대안** (고려한 다른 방법)
```

---

## 로컬 개발 환경

```bash
# 의존성 설치
pip install -r requirements.txt

# Claude Code 확인
claude --version

# 루틴 수동 테스트
python cli/run_routine.py morning-brief -p my-product

# 봇 로컬 실행
python src/bot.py

# 스케줄러 로컬 실행
python src/scheduler.py
```
