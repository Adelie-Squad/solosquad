# 데모 서버 절차서 (v2.1)

> **대상:** 에이전시 담당자 · **근거:** PRD v2.1.0 §3.6.3 ~ §3.6.4 · 결정 62 (2026-11-11) · DM1 ~ DM3
> **한 줄:** 고객 서버와 **같은 엔진 · 같은 웹 빌드**를 `core/server.yaml` `mode: demo` 로 띄운 서버 1대. 에이전트는 대본(`scripted` 하네스)으로만 말하고, 데모 계정마다 예시 회사(모아 리빙) 사본이 하나씩 생기며, 설정은 전부 읽기 전용이다.
> **원칙:** 데모 서버에는 문의 번호만 있다 — 신청자 이름 · 연락처는 마케팅 사이트 D1 에만. 비밀번호는 발급 때 한 번만 출력되고 해시만 남는다.

## 0. 무엇이 다른가 (demo 모드가 서버에서 강제하는 것)

| | 고객 서버 | 데모 서버 (`mode: demo`) |
|---|---|---|
| 에이전트 | 연결(구독 · API 키)로 모델 호출 | 대본 하네스 `scripted` — 모델 호출 0 · 비용 0. 연결 풀(`connections.yaml`)은 비어 있고, 대본 연결은 메모리에만 있다(주소 = 닫힌 포트 `127.0.0.1:9`) |
| 실행 정책 | 고객 설정 | 사본마다 `외부 API · 구독 CLI · 사내 LLM` 금지, 로컬만 |
| 워크플로우 | 고객 워크플로우 | 재무 관리 · 상품 소싱 · SNS 마케팅 — 단계가 대본 시간대로 진행, 승인 지점(팀 승인 · 대표 승인)에서 멈춤, 거절 = 대본의 거절 갈래. 결제 · 발주 · 게시는 "데모 — 실제로 보내지 않아요" 산출물만 |
| 로그인 | 계정 + 일회용 코드(또는 패스키) | 데모 계정만 · 비밀번호만 · 대소문자 무시(`samsungdemo` = `samsungDemo`) · 만료 뒤 `demo_expired` |
| 범위 | 대표 = 모든 org | 데모 계정 = **자기 사본(org) 하나의 대표**(다른 사본은 404) |
| 설정 | 대표가 바꿈 | 잠금 표 전부 `403 demo_read_only`(아래 5절) · 화면에 "데모에서는 바꿀 수 없어요" |
| 사용 기록 | 없음 | `core.db` `demo_usage`(아래 6절) |

## 1. VM 준비 (DM1 권장 — 에이전시 명의 작은 VM 1대)

- **2 vCPU · 4GB · 서울 리전**, Ubuntu LTS. 대본 하네스라 모델 프로세스가 없어 이 정도로 충분하다(사본 수십 개).
- 도메인 `demo.<에이전시 도메인>` → VM. 방화벽 443 · 관리용 SSH 만.
- 리버스 프록시 · 자동 TLS · `service install` 은 **고객 구축 절차서(`v2.1-customer-cloud-setup.md`) 2 ~ 4절 그대로** — 데모 서버가 그 절차서의 상시 리허설이 된다.

```bash
# 엔진 설치는 고객 서버와 같다 (절차서 3절)
export SOLOSQUAD_HOME=/var/lib/solosquad          # 데이터 폴더 (core.db · 사본들)
```

## 2. `demo init` — 데모 서버 만들기

```bash
solosquad demo init /srv/demo \
  --marketing-url https://<마케팅 사이트 주소> \
  --step-seconds 4 \
  --nightly-reset 04:00
```

만들어지는 것:

- `core/server.yaml` — `mode: demo`, `demo:` 설정(아래), `access.two_factor: false`, 나라 KR
- 고객 회사(회사 탭) = **모아 리빙 주식회사 (예시 회사)** — 한국 ↔ 중국 생활용품 유통, 이름 · 주소 모두 예시
- `demo/template/` — 계정마다 복사되는 예시 회사: `workflows/`(세 시나리오) · `artifact-kinds/` · `knowledge/company.md` · `files/`(은행 내역 · 마켓 정산 · 지급 대상 · 공급처 견적 3곳 · 발주 품목 · 지난주 반응 · 한 주 일정 · 게시 초안). **예시 숫자를 바꾸려면 이 폴더를 고치고 `demo reset --all`.**
- 아직 org 는 없다 — 사본은 발급할 때 생긴다.

`core/server.yaml` 의 `demo:` (PRD §3.6.4 · DM2 · DM3):

| 키 | 기본 | 뜻 |
|---|---|---|
| `step_seconds` | 4 | 에이전트 한 단계 시간(도구 단계는 절반). 첫 승인 지점까지 ≈ 10 ~ 15초 (PRD ≤ 60초) |
| `chat_seconds` | 1.5 | 대본 대화 답이 흘러나오는 시간 |
| `default_days` | 14 | 발급 기본 기간 |
| `nightly_reset` | `"04:00"` | 매일 이 시각(서버 시간)에 모든 사본을 템플릿으로 다시 만든다. `null` = 끔 |
| `idle_minutes` | 30 | 방문자 런타임은 로그인 때 뜨고 이만큼 쉬면 내린다 |
| `delete_after_days` | 7 | 만료 · 회수 뒤 이만큼 지나면 사본을 지운다(사용 기록은 남김) |
| `usage_keep_days` | 365 | 만료 뒤 이만큼 지나면 그 계정의 사용 기록을 지운다(L9 — 문의 보유와 같이) |
| `marketing_url` | — | 데모 로그인 폼을 받을 `Origin` · 실패 시 돌아갈 곳(`/demo?error=1`) |
| `contact_url` | `<marketing_url>/?contact=demo` | 데모 띠의 "상담 요청" 링크 |

서버 띄우기 — 고객 서버와 같은 명령, 모드는 파일이 정한다:

```bash
solosquad serve -s /srv/demo --port 7420      # "DEMO MODE — scripted agents, settings read-only"
solosquad service install -s /srv/demo        # 상시 운영 (절차서 4절)
```

## 3. 문의에서 발급하기

마케팅 관리자 스크립트(`marketing/scripts/inquiry.mjs issue <id>`)가 ssh 로 부르는 명령 — 직접 쳐도 같다:

```bash
ssh demo 'solosquad demo issue --id samsungDemo --inquiry <문의 번호> --company-no 1234567890 --days 14 --locale ko -s /srv/demo'
```

출력(`key=value` 네 줄은 스크립트가 읽는 고정 형식):

```
issued samsungDemo · inquiry <문의 번호> · expires 2026-11-25 18:58
company no: 1234567890
login id: samsungDemo
password: Xk7m…   (shown once — only its hash is kept)
demo_id=samsungDemo
password=<16자>
expires=2026-11-25 18:58
company_no=1234567890
```

- **법인(사업자)등록번호** `--company-no`(필수) — 문의에 적힌 대표 번호 하나. 사업자등록번호(10자리, `123-45-67890`) · 법인등록번호(13자리, `110111-1234567`)는 숫자만, 다른 나라 번호는 영문 · 숫자 · `-` 4–30자를 대문자로 저장한다. 데모 로그인에서 아이디 · 비밀번호와 함께 이 번호를 받는다(2026-11-12). 이 열이 생기기 전에 발급한 계정은 번호가 비어 있어 데모 로그인이 늘 실패한다 — 다시 발급한다.

- **아이디 형식** `<slug>Demo`(대문자 D) — 영문 · 숫자, 영문으로 시작, 겹치면 `samsungDemo2`. 대소문자 무시로 유일. 형식이 틀리면 거절.
- 발급하면 그 계정 몫 **사본 1개**(org `samsungdemo` · 워크스페이스 `hq` 본사)가 생긴다: 세 워크플로우 · 예시 사람 2명(김재무 · 이마케 — 지어낸 이름, 로그인 불가) · 일정 · **어제 돌린 것처럼 끝난 실행 · 산출물 · 승인 기록**(대시보드 "자리를 비운 동안" 이 비지 않게).
- 서버가 돌고 있어도 된다 — 서버가 몇 초 안에 새 계정을 알아본다(재시작 없음).
- 다른 언어 방문자: `--locale en` · `--locale zh-CN`(화면 언어 — 방문자가 언어 탭에서 바꿀 수도 있다).

데모 로그인 경로는 **하나뿐**이다(2026-11-12):

1. **마케팅 사이트 `/demo`** — 폼이 `POST https://demo.<도메인>/api/auth/demo-login`(form-urlencoded `company_no` · `username` · `password`, 최상위 이동)으로 직접 보낸다 → 성공 303 `/dashboard` · 실패(번호 틀림 · 비밀번호 틀림 · 없는 아이디 · 만료 모두 같게) 303 `<marketing_url>/demo?error=1`. 번호는 계정에 저장된 번호와 같아야 한다(`-` · 공백 · 대소문자 무시). 번호가 틀리면 비밀번호 틀림과 같이 실패 횟수에 들어간다. `Origin` 이 `marketing_url`(또는 서버 자신의 `public_url`)이 아니면 받지 않는다.
2. ~~데모 서버의 `/login?demo=1`~~ — 이제 비밀번호 폼이 없다. 데모 서버의 `/login`(`?demo=1` 이든 아니든 — 로그아웃 뒤 오는 곳)은 마케팅 `/demo` 로 가는 링크 하나를 보인다(`GET /api/health` 의 `demo_login_url` = `<marketing_url>/demo`). `marketing_url` 이 없으면 중립 문장 한 줄만 보인다. 서버도 막는다. 데모 계정이 JSON 로그인(`POST /api/auth/login`, `?demo=1` 포함)이나 패스키로 들어오면 비밀번호가 맞아도 틀린 비밀번호와 같은 `login_failed` 로 거절하고, 실패 횟수에 넣는다. 데모 서버는 원래 데모 계정이 아닌 계정(운영자 등)을 받지 않는다. 이 규칙은 바뀌지 않았다.

## 4. 운영 명령

```bash
solosquad demo list -s /srv/demo                                   # 아이디 · 문의 · 번호 · 상태 · 만료
solosquad demo extend --id samsungDemo --days 7 -s /srv/demo       # 만료를 지금부터 7일로 (만료된 계정도 다시 로그인)
solosquad demo revoke --id samsungDemo -s /srv/demo                # 즉시 끝: 로그인 꺼짐 + 사본 삭제 (사용 기록은 남음)
solosquad demo reset  --id samsungDemo -s /srv/demo                # 그 계정 사본을 처음 상태로
solosquad demo reset  --all -s /srv/demo                           # 모든 활성 계정
```

- 서버가 돌고 있으면 `reset` · `revoke` 는 **행만 바꾸고 서버가 몇 초 안에 적용**한다(런타임이 쥔 파일을 CLI 가 건드리지 않는다). 서버가 꺼져 있으면 그 자리에서 한다.
- 방문자도 사이드바 아래 **처음 상태로** 로 자기 사본을 언제든 되돌린다(로그인은 유지). 워크플로우 화면의 **시나리오 다시 시작** 은 열린 실행만 멈추고 세 시나리오를 다시 시작한다(지난 기록은 남김).

### 밤 초기화

서버가 `nightly_reset`(기본 04:00) 에 스스로 한다 — 모든 활성 사본을 템플릿으로 다시 만들고 `reset {by: nightly}` 를 남긴다. 서버 안 타이머 대신 cron 을 쓰려면 `nightly_reset: null` 로 끄고:

```cron
0 4 * * *  SOLOSQUAD_HOME=/var/lib/solosquad /usr/local/bin/solosquad demo reset --all -s /srv/demo
```

## 5. 잠금 표 (PRD §3.6.4 ③ · C59)

서버가 `403 demo_read_only` 로 막고(`web_api/app.py` `DEMO_READ_ONLY` · `SELF_LOCKED`), 웹은 `/api/me` `demo_info.locked` 로 같은 표를 받아 잠근다. 테스트가 표 전수를 부른다(`python/tests/test_demo.py`).

| 잠금 | 무엇 |
|---|---|
| 설정 | 회사 · 접속 정책(서버 · 워크스페이스) · 스냅샷 대상 · 지금 스냅샷 · 승인 등급 · 워크플로우 켜고 끄기 · 일정 구분 · 태그 · 에이전트 열람 범위 |
| 사람 · 계정 | 구성원 추가 · 역할 · 할당 · 끄기 · 비밀번호 재설정 · 팀 소속 · 직함 · 내 비밀번호 · 패스키 · 일회용 코드 |
| 연결 | API 키 추가 · 토글 · 삭제(메신저 연결은 아직 서버 기능이 없다) |
| 되돌릴 수 없는 일 | 일정 항목 · 할 일 지우기 · 스냅샷 |
| 올리기 | 파일 업로드(데모 시나리오는 예시 파일로만 돈다) |
| **열어 둠** | 화면 언어 · 화면 테마 · 승인 · 거절 · 지금 실행 · 대화(추천 요청) · 일정 · 할 일 추가 · 고치기 · 산출물 확인 표시 · 로그아웃 · 처음 상태로 |

## 6. 사용 기록 내보내기 (PRD §3.6.3 · C61)

```bash
ssh demo 'solosquad demo usage --id samsungDemo --format csv -s /srv/demo'        # 요약 1행
ssh demo 'solosquad demo usage --all --format csv -s /srv/demo' > usage.csv       # 계정마다 1행
ssh demo 'solosquad demo usage --id samsungDemo --events --format csv --since 2026-11-01 -s /srv/demo'
```

요약 열: `demo_id · inquiry_id`(D1 문의와 붙이는 열) · 상태 · 발급 · 만료 · 첫 로그인 · 첫 로그인까지 걸린 날 · 로그인 · 거절된 로그인 · 세션 수 · 총 분 · 마지막 · 기기 · 시작한 시나리오 · 끝까지 돈 시나리오 · 승인 / 거절 클릭 · 요청 수 · 대본과 맞은 요청 · 눌러 본 잠긴 설정 · 초기화 · 본 화면. **합친 결과는 담당자 컴퓨터에서만 보고 어디에도 다시 올리지 않는다.**

수집하는 것과 하지 않는 것은 `python/README.md` "데모 모드 — 수집하는 데이터" 에 적혀 있다(동의 문구 개정은 PRD §3.6.3 고지 `[검토 필요]`).

## 7. 점검

```bash
curl -s https://demo.<도메인>/api/health          # {"ok": true, …}
solosquad demo list -s /srv/demo                  # 활성 계정
journalctl -u solosquad -n 50                     # "DEMO MODE" 줄 · reconcile 오류
```

- 방문자가 "아무것도 안 움직인다" — 런타임이 쉬는 중이면 다음 화면 새로고침(`/api/me`)에서 깨어난다. 계속이면 `demo reset --id …`.
- 모델 호출이 의심되면 — 가계부(`/api/o/<사본>/w/hq/ledger`)의 `harness` 가 전부 `scripted` · 비용 0 이어야 한다.
