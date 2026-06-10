# CLI Auto-Update — Claude Code 패턴 채택 ideation

- **작성일**: 2026-05-22
- **상태**: ideation (plan 승격 전 단계)
- **청자**: SoloSquad 개발자(본인)
- **관련 코드**: `src/cli/update.ts`, `src/cli/migrate.ts`, `src/cli/index.ts`(시작 hook)

## 배경

현재 SoloSquad CLI 업데이트 흐름:

| 명령                          | 영역                  | 사용자 액션          |
| :---------------------------- | :-------------------- | :------------------- |
| `npm install -g solosquad`    | CLI 바이너리          | 수동 실행            |
| `solosquad update`            | CLI 바이너리 (wrapper) | 명령 호출 → y 응답   |
| `solosquad migrate`           | 워크스페이스 파일     | `--apply` 직접 호출  |

`printUpdateBanner()`([src/cli/update.ts:115](../../src/cli/update.ts#L115))는 시작 시 새 버전 안내 배너만 띄우고, 실제 설치는 사용자가 `solosquad update`를 호출해야 한다. **알림 → 액션 사이에 사용자 손이 끼는 단계가 1번 더 있다.**

Claude Code는 이 갭을 **백그라운드 detach install**로 메운다. 본 문서는 그 패턴을 SoloSquad에 적용하기 위한 구체 설계를 정리한다.

## Claude Code의 auto-update 메커니즘 (관찰)

1. CLI 시작 시 npm registry를 **비동기**로 조회 — 현재 세션은 블로킹되지 않음.
2. 새 버전이 감지되면 **자식 프로세스를 detach해서** `npm install -g <pkg>@latest`를 백그라운드 실행.
3. 현재 세션은 그대로 끝나고, **다음 실행 때부터** 새 버전이 적용됨.
4. `~/.claude/settings.json`의 `autoUpdates: true|false`로 opt-out.
5. 자기 자신을 덮어쓰는 npm 명령이 실행 중인 CLI를 망가뜨리지 않도록 detach가 필수 — 특히 Windows의 파일 lock 이슈 회피.

핵심 코드 패턴:

```ts
const child = spawn('npm', ['install', '-g', 'solosquad@latest'], {
  detached: true,
  stdio: 'ignore',           // 부모 출력에 끼어들지 않음
});
child.unref();                // 부모가 먼저 종료돼도 자식은 살아남음
```

## 제안 — SoloSquad auto-update 분기 설계

### A. 트리거 위치

`printUpdateBanner()`를 확장. 시작 hook(`src/cli/index.ts`)에서 호출되는 이 함수 안에:

1. `~/.solosquad/settings.json` 읽어서 `autoUpdate` 플래그 확인 (기본값: `false` — opt-in)
2. `getRemoteVersion()` 결과가 새 버전이면 분기:
   - **자동 install 안전 조건 충족** → detach spawn
   - 그 외 → 기존 배너만 표시

### B. "자동 install 안전 조건"

자동 install은 **워크스페이스 마이그레이션이 필요 없는 점프**에서만 허용. [update.ts:71](../../src/cli/update.ts#L71)에 이미 있는 structural-jump 감지를 재사용:

| 점프 종류                             | 자동 install | 이유                                     |
| :------------------------------------ | :----------- | :--------------------------------------- |
| patch (1.1.3 → 1.1.4)                 | ✓            | 워크스페이스 layout 동일                 |
| minor, layout 호환 (1.1.x → 1.2.x but no migration script) | ✓ | 동일 |
| minor, layout 변경 (1.1.x → 1.2.x with new `src/migrations/scripts/1.1.x-to-1.2.0.ts`) | ✗ | `migrate --apply` 동의 필요 |
| major (1.x → 2.0)                     | ✗            | 사용자 확인 받기                         |

판정 로직: `src/migrations/scripts/` 디렉터리에 `<current>-to-<latest>` 마이그레이션 스크립트가 **존재하면** 자동 install 차단. 이건 npm registry에서 알기 어려우므로 두 가지 옵션:

1. **보수적**: minor/major 점프는 무조건 차단, patch만 자동. (단순, 안전)
2. **정교**: `npm view solosquad@<latest>`로 새 버전 package.json을 fetch해서 `solosquad-migrations` 필드 확인. (추가 fetch 1회)

→ 1안으로 시작 권장.

### C. 자식 프로세스 처리

```ts
// src/cli/update.ts — printUpdateBanner 확장
async function maybeAutoUpdate(current: string, latest: string): Promise<void> {
  const settings = readSettings();
  if (!settings.autoUpdate) return;

  // 1안: patch만 자동
  const [cMaj, cMin] = parseVersion(current);
  const [lMaj, lMin] = parseVersion(latest);
  if (cMaj !== lMaj || cMin !== lMin) {
    // minor/major는 배너만, install은 사용자가
    return;
  }

  const logPath = path.join(os.homedir(), '.solosquad', 'auto-update.log');
  const logFd = fs.openSync(logPath, 'a');
  const cmd = npmGlobalInstallCmd('solosquad@latest');
  const [bin, ...args] = cmd.split(' ');

  const child = spawn(bin, args, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  child.unref();

  // 마커 파일로 다음 실행 때 "업데이트됨" 안내
  fs.writeFileSync(
    path.join(os.homedir(), '.solosquad', 'pending-update.json'),
    JSON.stringify({ from: current, to: latest, startedAt: Date.now() }),
  );
}
```

### D. 다음 실행 시 결과 안내

CLI 시작 시 `pending-update.json` 존재하면:

1. `solosquad --version` 으로 실제 적용된 버전 확인
2. `pending.to` 와 일치하면 → `chalk.green('✓ Auto-updated to v<X.Y.Z>')` 표시 후 마커 삭제
3. 일치 안 하면 → `chalk.yellow('Auto-update may have failed. Check ~/.solosquad/auto-update.log')` 표시

### E. opt-in/out UX

- 기본값: `autoUpdate: false` (opt-in, 사용자 놀라게 하지 않기)
- `solosquad update --enable-auto` / `--disable-auto` 플래그로 토글
- 첫 `solosquad update` 호출 시 한 번만 "auto-update 켤래?" 물어보고 settings에 저장 (Claude Code 패턴)

## 위험 / 엣지케이스

| 위험                                      | 완화책                                                                 |
| :---------------------------------------- | :--------------------------------------------------------------------- |
| Windows에서 실행 중인 `solosquad.cmd` 파일 lock | detach + 다음 실행 때 적용 패턴 자체가 이 문제를 회피                 |
| npm 권한 부족 (sudo 필요)                 | `npmGlobalInstallCmd()` 가 이미 sudo prefix 처리 — 단 detach 환경에서 sudo 프롬프트 뜨면 hang 가능 → 로그에 실패 기록되도록 |
| 네트워크 없음                             | `getRemoteVersion()` 이 null 반환 → 조용히 skip                       |
| 사용자가 같은 시점에 수동 `npm install` 실행 | npm 자체 lock으로 한쪽 실패 → 로그만 남고 다음 실행 때 재시도         |
| 마이그레이션 누락된 layout 점프 자동 실행 | "patch만 자동" 정책으로 원천 차단                                      |
| corporate proxy 환경                      | npm 설정 그대로 상속 (spawn은 환경변수 inherit)                        |

## 다음 단계 (plan 승격 시)

1. `src/util/settings.ts` 에 `autoUpdate` 필드 추가 + read/write helper
2. `src/cli/update.ts` 의 `printUpdateBanner` → `maybeAutoUpdate` 분기 추가
3. `src/cli/index.ts` 시작 hook에 `pending-update.json` 결과 안내 추가
4. `solosquad update --enable-auto` / `--disable-auto` 플래그
5. 통합 테스트: detach 프로세스가 정상 종료되는지, 마커 파일이 정확히 cleanup되는지
6. **manual/master-guide_{ko,en}.html** 에 auto-update 섹션 추가 (3-doc gate)
7. **docs/plan/product-roadmap.md** 에 해당 버전 행 추가, **docs/plan/architecture.md** §13.x 갱신

## 참고 — 현재 코드와의 차이

| 단계                | 현재                          | 제안                            |
| :------------------ | :---------------------------- | :------------------------------ |
| 새 버전 감지        | ✓ ([update.ts:115](../../src/cli/update.ts#L115)) | 동일                            |
| 사용자 알림         | ✓ (배너)                      | 동일 + auto-install 시 별도 톤  |
| install 실행        | 사용자 명령 → `y` 입력         | (patch면) detach 백그라운드     |
| 워크스페이스 migrate | 별도 `solosquad migrate`      | 동일 — auto-install 범위 밖     |
| 결과 안내           | 동일 세션 내                  | 다음 실행 시 마커 기반 안내     |
