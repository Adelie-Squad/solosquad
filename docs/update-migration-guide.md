# 업데이트 & 마이그레이션 가이드

> solosquad를 최신 버전으로 유지하고, 구조가 바뀌는 업데이트(마이그레이션)를 안전하게 적용하는 방법.

이 문서는 **사용자용** 안내입니다. 마이그레이션 프레임워크 내부 구현은 `docs/v1.2.3-migration-process.md`를 참조.

---

## 1. 버전 규칙 (한 줄 요약)

- `vN.N.N` 3자리 (예: `v1.1.5`, `v1.2.0`)
- **patch** 자리(세 번째): 버그 수정·작은 개선 — 마이그레이션 거의 없음
- **minor** 자리(두 번째): 새 기능·구조 변경 — 마이그레이션 필요할 수 있음
- **major** 자리(첫 번째): 근본적 개편 — 마이그레이션 필수

현재는 `v1.x.x` 대역이며, v1 대역 내에서도 **구조 변경은 minor 자리에서 발생할 수 있습니다**(v1.2.0 예정).

---

## 2. 현재 버전 확인

```bash
solosquad --version
```

레지스트리의 최신 버전과 비교하려면:

```bash
solosquad update
```

최신 버전 번호와 "업데이트 필요 여부"를 알려줍니다. 실제 업데이트는 사용자 확인 후 진행.

---

## 3. 일반 업데이트 (마이그레이션 불필요)

대부분의 patch 업데이트는 아래 한 줄로 끝.

```bash
solosquad update
# → "New version available: vX.Y.Z" → y → 자동 설치
```

또는 수동으로:

```bash
npm install -g solosquad@latest
```

업데이트 후 확인:

```bash
solosquad --version
solosquad doctor
```

`doctor`가 모두 ✓이면 정상 작동 중.

---

## 4. 마이그레이션이 필요한 업데이트

버전에 구조 변경이 포함되면 `solosquad update`가 다음과 같이 경고합니다:

```
⚠ This update includes breaking changes to the workspace layout.
  A workspace migration is required. After updating the CLI, run:
    solosquad migrate --dry-run         (preview changes)
    solosquad migrate --apply           (perform migration)
```

이 안내가 보이면 순서는 반드시:

1. CLI 먼저 업데이트 (`npm install -g solosquad@latest`)
2. 워크스페이스로 `cd`
3. `solosquad migrate --dry-run` — 어떤 변경이 일어날지 미리보기
4. 출력을 검토하고 문제 없어 보이면 `solosquad migrate --apply`
5. `solosquad doctor` 로 건강 상태 확인
6. `solosquad bot` 다시 시작

### 4.1 Apply 전 필수 체크리스트 (주의사항)

- [ ] **`solosquad bot` / `solosquad schedule` 완전히 종료** — 실행 중이면 파일 lock 때문에 이동 실패 가능 (Ctrl+C 또는 `docker compose down`)
- [ ] **VSCode / JetBrains IDE 에서 해당 워크스페이스·repo 닫기** — Windows 에서 특히 파일 핸들이 걸려 rename/move 가 막힘
- [ ] **외부에서 절대경로로 하드코딩한 스크립트·바로가기 확인** — `C:\...\Documents\solosquad-repos\<slug>` 같은 경로가 있으면 마이그레이션 후 `<workspace>\<slug>` 로 수정 필요
- [ ] **먼저 dry-run 실행** — `solosquad migrate`(플래그 없음) 또는 `--dry-run`
- [ ] **작업 중 코드는 미리 commit/stash** — 마이그레이션은 `.git/` 포함 폴더 전체를 옮기지만, dirty working tree 는 사용자가 직접 정리해두는 편이 안전

### 4.2 알려진 이슈 (v1.1.x → v1.2.0 점프 시)

- **`solosquad update` 가 마이그레이션 경고를 띄우지 않습니다.** 마이그레이션 감지 코드는 v1.2.0 에서 새로 추가됐기 때문에, v1.1.5 CLI 가 업데이트를 수행하는 순간에는 경고 로직이 존재하지 않습니다. v1.2.x → v1.3.x 같은 이후 점프부터는 정상 경고. v1.1.x 에서 올라오는 사용자는 **업데이트 직후 `solosquad migrate` 를 수동으로 한 번 실행**하세요.
- **`--dry-run` 플래그가 CLI 에 등록돼 있지 않을 수 있습니다** (v1.2.0 초기 빌드). `solosquad migrate`(플래그 없음) 만 입력해도 dry-run 으로 동작합니다. 실제 이관은 `--apply`.

### 4.3 Dry-run이 무엇을 보여주나

```bash
$ solosquad migrate --dry-run
Workspace: /Users/you/solosquad-workspace
Detected structure: v1.1.x  (source)
Target version:     v1.2.0  (installed CLI)

Migration plan (1.1.x → 1.2.0):

  ✓ Move workspace config to .solosquad/
  ✓ Convert each product → organization directory
  ✓ Rename projects/ → workflows/
  ✓ Remove obsolete env vars (REPOS_BASE_PATH)

Estimated disk usage: +0 MB (moves only, no copies)
Backup location:      /Users/you/.solosquad-backups/2026-...

Nothing written yet. Re-run with `--apply` to perform the migration.
```

**Dry-run은 아무것도 바꾸지 않습니다.** 마음에 안 들면 그냥 무시하면 됨.

### 4.4 Apply가 자동으로 해주는 것

- 작업 전 워크스페이스 **전체 스냅샷 백업** (기본: `~/.solosquad-backups/<타임스탬프>/`)
- 파일·폴더 이동/이름변경
- 새 설정 파일 자동 생성 (`.solosquad/workspace.yaml`, `.org.yaml` 등)
- 마이그레이션 후 `doctor` 자동 실행으로 검증

### 4.5 여러 버전을 건너뛸 때

v1.1.2를 쓰다가 v1.3.0으로 직접 업데이트할 경우, 마이그레이션이 **체인**으로 순차 실행됩니다:

```
Chaining migrations:
  1.1.x → 1.2.0  (layout restructure)
  1.2.0 → 1.3.0  (cross-repo enhancements)
```

각 단계는 dry-run 후 한꺼번에 apply. 중간에 실패하면 해당 단계까지만 롤백.

---

## 5. 롤백 (되돌리기)

뭔가 잘못됐다고 느껴지면:

```bash
solosquad migrate --rollback
```

가장 최근 백업부터 역순으로 선택지가 뜨고, 고른 백업 시점으로 워크스페이스를 복원합니다.

**주의:** 롤백 후에는 **복원된 버전에 맞는 CLI**를 쓰세요. v1.2.0로 마이그레이션했다가 v1.1.5 상태로 롤백했다면 CLI도 v1.1.5로 다운그레이드:

```bash
npm install -g solosquad@1.1.5
```

CLI와 워크스페이스 버전이 불일치하면 `doctor`가 경고합니다.

---

## 6. 백업 관리

백업은 기본적으로 `~/.solosquad-backups/<ISO-타임스탬프>-v<소스버전>/`에 저장됩니다.

```bash
solosquad migrate --list-backups   # 목록 조회
solosquad migrate --delete-backup <id>   # 수동 삭제
```

자동 보존 정책: **최근 5개만 유지**. 6번째 마이그레이션 시 가장 오래된 백업이 삭제됩니다.

중요한 시점의 백업은 다른 경로로 복사해서 별도 보관해두는 것을 권장 (예: 외장 디스크, 클라우드 드라이브).

---

## 7. Docker 사용자

컨테이너 기반으로 운영 중이라면 업데이트 방식이 약간 다릅니다.

```bash
# 1. 컨테이너 중지
docker compose down

# 2. 호스트에서 CLI 업데이트 (마이그레이션 감지 + 실행용)
npm install -g solosquad@latest

# 3. 마이그레이션 필요 시
solosquad migrate --dry-run
solosquad migrate --apply

# 4. Docker 이미지 재빌드 (솔로스쿼드 새 버전 반영)
docker compose up -d --build
```

**마이그레이션은 반드시 호스트에서** 실행. 컨테이너 안에서 하면 볼륨 매핑에 따라 혼란이 생길 수 있음.

---

## 8. 업그레이드 실패 트러블슈팅

### "Cannot find package.json" 같은 에러

설치된 패키지가 깨졌을 수 있음. 캐시 비우고 재설치:

```bash
npm cache clean --force
npm uninstall -g solosquad
npm install -g solosquad@latest
```

### 마이그레이션 중단됨

```bash
solosquad migrate --rollback   # 가장 최근 백업으로 복원
```

그 다음 지원 채널(GitHub Issues)에 로그와 함께 보고하세요.

### 마이그레이션 후 `bot`이 안 뜸

```bash
solosquad doctor
```
의 출력을 먼저 확인. 토큰 누락·`.env` 위치 이상이 흔한 원인.

### Claude Code 인증이 풀림

v1.2.0부터 Docker 이미지가 `${HOME}/.claude` 볼륨을 마운트하므로 호스트의 `claude login` 상태가 컨테이너에 공유됩니다. 호스트에서 다시 로그인:

```bash
claude login
docker compose restart
```

### 어떤 버전으로 업그레이드할지 모르겠음

릴리스 노트를 먼저 보세요:
- GitHub Releases: https://github.com/Adelie-Squad/solosquad/releases
- `docs/plan.md` — 현재 릴리스 현황

breaking change가 포함된 minor 업데이트는 회사·중요 프로젝트 용으로는 **일주일 정도 관찰** 후 올라가는 것도 합리적 선택.

---

## 9. 멀티 워크스페이스 업데이트

페르소나별로 워크스페이스를 여러 개 쓰는 경우, CLI 업데이트는 한 번이면 되지만 **마이그레이션은 각 워크스페이스에서 개별 실행**.

```bash
npm install -g solosquad@latest

cd ~/solopreneur
solosquad migrate --dry-run
solosquad migrate --apply

cd ~/elon-24-7
solosquad migrate --dry-run
solosquad migrate --apply
```

각 워크스페이스는 독립된 백업을 가지므로 하나가 실패해도 다른 워크스페이스는 영향받지 않습니다.

---

## 10. 자주 묻는 질문

**Q. 업데이트 전에 꼭 해야 할 일이 있나요?**
A. `solosquad bot` / `schedule`이 실행 중이면 먼저 정지시키세요. `docker compose down` 또는 터미널 `Ctrl+C`.

**Q. 매번 업데이트해야 하나요?**
A. 아닙니다. 안정적으로 쓰고 있다면 급할 이유는 없습니다. 다만 **보안 hotfix**(예: v1.1.3 dotenv 누락)는 빠르게 적용 권장.

**Q. 업데이트 자동화가 가능한가요?**
A. Docker 환경이면 `docker compose up -d --build`를 cron에 걸면 이미지 최신화됩니다. 하지만 **마이그레이션 필요 시엔 자동화 불가** — 사람의 확인이 들어가는 게 원칙.

**Q. 예전 버전으로 고정하고 싶어요.**
A. `npm install -g solosquad@1.1.5`처럼 명시적 버전으로 설치. `solosquad update`가 업그레이드를 제안해도 거절하면 됨.

**Q. 여러 사람이 한 머신에서 씁니다.**
A. 각자 OS 계정을 다르게 쓰고, 각 계정의 홈 디렉토리에 독립된 워크스페이스를 두세요. 마이그레이션도 계정별로 따로 진행.

**Q. 베타·개발 채널이 있나요?**
A. `solosquad update --channel dev`로 전환 가능 (단, 안정성 없음). `--channel stable`이 기본.

---

## 11. 마이그레이션 이후 — org/repo 관리 명령 (v1.2.0+)

v1.2.0 부터는 단일 트리 아래에서 여러 org/repo 를 운영할 수 있습니다.

### 11.1 사업(org) 추가

```bash
solosquad add org <name>               # 대화형
solosquad add org my-side --provider github --remote-url https://github.com/my-side
```

`<workspace>/<name>/` 폴더 + `.org.yaml` + `memory/` + `workflows/` + `repositories/` + `<messenger>/` 자동 생성.

### 11.2 저장소(repo) 추가

URL 이면 clone, 경로면 등록(필요시 이동).

```bash
solosquad add repo https://github.com/foo/bar.git     # clone + 등록
solosquad add repo ./existing-local-repo              # 이동(확인 후) + 등록
solosquad add repo --org tesla --role frontend <url>  # 플래그로 org/role 지정
```

사업이 **하나뿐이면 자동 선택**, 여럿이면 질문 또는 `--org <slug>` 플래그. cwd 가 특정 org 안이면 그 org 자동 선택.

### 11.3 Bulk 동기화

이미 `repositories/` 에 clone 해둔 repo 들을 한 번에 등록:

```bash
solosquad sync                         # 모든 org 스캔
solosquad sync --org tesla             # 특정 org만
solosquad sync --dry-run               # 미리보기
```

동작:
- `repositories/<folder>` 중 `.git` 있는데 `repo.yaml` 없는 경우 자동 등록
- `.org.yaml.products[].repos` 를 실제 상태와 맞춰 갱신
- `.git` 없는 폴더는 경고 스킵
- `.org.yaml` 에 나열됐지만 실제 폴더가 없는 repo 는 경고

### 11.4 Legacy 정리 (v1.1.x → v1.2.0 마이그레이션 직후)

마이그레이션 스크립트는 각 product 를 org 로 바꾸되, **`.git` 을 org 루트에 그대로** 둡니다 (v1.1.x 에서 product=repo 였던 자취). `solosquad sync` 첫 실행 시 이 상태를 감지하고 두 가지 선택을 제공:

- **Normalize (권장)** — 코드와 `.git` 을 `<org>/repositories/<org-slug>/` 로 이동. 앞으로 repo 여러 개 붙일 거면 필수.
- **Keep legacy** — 현상 유지. `<org>/.solosquad/repo.yaml` 을 org 루트에 생성해 "org = 단일 repo" 로 고정. 저장소 한 개만 쓸 거면 OK.

Normalize 후 봇은 자동으로 `<org>/repositories/<repo>/` 를 cwd 로 사용. Keep legacy 면 org 루트가 cwd.

---

## 12. 요약

- 일반 업데이트: `solosquad update` → y
- 마이그레이션 업데이트: `npm install -g solosquad@latest` → `solosquad migrate --dry-run` → `--apply`
- 문제 시: `solosquad migrate --rollback`
- 마이그레이션 직후: `solosquad sync` 로 legacy 정리
- 사업/저장소 추가: `solosquad add org <name>` / `solosquad add repo <url|path>`

업데이트는 두렵지 않아야 합니다. 백업은 자동, 롤백은 한 줄, 진행은 선택.
