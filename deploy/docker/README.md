# Docker 배포 (v0.5+)

SoloSquad 봇과 scheduler를 컨테이너로 24/7 운영하는 옵션. 4 hosting
옵션(terminal · Docker · launchd/NSSM · VPS systemd) 중 하나.

## 빠른 시작

```bash
cd deploy/docker
docker compose up -d --build
```

봇과 scheduler 두 컨테이너가 백그라운드로 떠 자동 재시작됩니다. 새 npm
릴리스를 받으려면 `docker compose up -d --build` 재실행.

## 마운트 볼륨

| 호스트 경로 | 컨테이너 경로 | 역할 |
|---|---|---|
| `${SOLOSQUAD_WORKSPACE:-../..}` (repo root) | `/workspace` | 워크스페이스 (agents/routines/core/<org>/.agents/.solosquad/) |
| `${REPOS_BASE_PATH:-<ws>/repos}` | `/repos` | 사용자 product repos |
| `${CLAUDE_AUTH_DIR:-${HOME}/.claude}` | `/root/.claude` | Claude Code CLI 인증 |
| `${HOME}/.solosquad` | `/root/.solosquad` | **v0.5 user-global SKILL override (3-tier 2층)** |
| `${HOME}/.solosquad-backups` | `/root/.solosquad-backups` | **v0.2.3 워크스페이스 backup** |

## 환경 변수

`.env` 파일은 워크스페이스 루트에 둡니다. 컴포즈가 `${SOLOSQUAD_WORKSPACE:-../..}/.env`
경로로 자동 로드. 주요 변수:

- `MESSENGER=discord|slack` — 메신저 플랫폼
- `DISCORD_TOKEN` / `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` — 메신저 토큰
- `ANTHROPIC_API_KEY` — Claude 인증(또는 `/root/.claude` 마운트로 대체)
- `TZ=Asia/Seoul` — 타임존
- `REPOS_BASE_PATH` — repos 트리 경로 override
- `CLAUDE_AUTH_DIR` — Claude 인증 디렉토리 override
- `SOLOSQUAD_WORKSPACE` — 워크스페이스 루트 override (다중 워크스페이스 운영 시)

## 다른 워크스페이스에서 실행하기

repo를 clone한 위치와 *다른* 디렉토리에 워크스페이스가 있다면:

```bash
SOLOSQUAD_WORKSPACE=/abs/path/to/my-workspace \
docker compose up -d --build
```

또는 `.env`에 `SOLOSQUAD_WORKSPACE=/abs/path/to/my-workspace` 기록.

## v0.5 호환 메모

- `~/.solosquad/agents/` (user-global override)와 `~/.solosquad-backups/` 두
  마운트가 추가되어 v0.5 3-tier 라우팅과 마이그레이션 rollback이 컨테이너에서
  정상 작동합니다. v0.4 이하 docker-compose는 이 두 볼륨이 없어 *user-global
  SKILL을 볼 수 없는* 제약이 있었습니다.
- v0.4 goal-runner는 `solosquad bot` 컨테이너의 백그라운드 PM session으로
  실행되므로 별도 service 불필요. `solosquad goal status`로 외부에서 모니터링
  가능 (호스트에서 `docker exec solosquad-bot solosquad goal status`).

## 로그 보기

```bash
docker compose logs -f bot
docker compose logs -f scheduler
```

## 중지·재시작

```bash
docker compose down            # 중지
docker compose up -d --build   # 재시작 + 이미지 갱신
```
