# Author-guard handle decoupling — Discord 닉네임 ≠ SoloSquad handle ideation

- **작성일**: 2026-05-22
- **상태**: ideation (plan 승격 전 단계 — 본 문서로 추가 논의 후 v1.0.2 또는 v1.1 슬롯 결정)
- **청자**: SoloSquad 개발자(본인)
- **관련 코드**: [`src/bot/author-guard.ts`](../../src/bot/author-guard.ts), [`src/bot/user-registry.ts`](../../src/bot/user-registry.ts), [`src/bot/channel-bootstrap.ts`](../../src/bot/channel-bootstrap.ts), `<workspace>/<org>/.solosquad/users/<handle>.yaml`
- **계기 incident**: v1.0.1 publish 직전 사용자(`discord_username: seungw1n`, `solosquad_handle: w1n`) 가 자기 자신의 `command-w1n` 채널에서 메시지 발사 → author-guard 가 차단 후 *"이 채널은 w1n의 명령 전용입니다. command-seungw1n 채널을 사용하세요"* DM 발사. **자기 자신을 자기 채널에서 추방**한 false positive.

## 1. Incident 재현

### 1.1 환경
- Workspace 등록 user yaml: `handle: w1n`
- Discord 사용자 본명/계정명: `seungw1n#xxxx`
- 봇 부팅 로그:
  ```
  [Discord Bot] Bound to handle=w1n org=rosyocean (channels: command-w1n / works-w1n)
  ```
- 채널 자동 생성: `command-w1n`, `works-w1n`

### 1.2 트리거
사용자가 자신의 `command-w1n` 채널에 메시지 발사 → 봇이 메시지 무시 + DM 발사:
```
이 채널은 w1n의 명령 전용입니다. command-seungw1n 채널을 사용하세요.
```

### 1.3 root cause — author-guard 비교 식

[`src/bot/author-guard.ts:16-23`](../../src/bot/author-guard.ts#L16):

```ts
export function isAuthorizedAuthor(
  channelName: string,
  authorHandle: string,
): boolean {
  const parsed = parseChannelName(channelName);
  if (!parsed) return true; // broadcast / unrelated channel
  return parsed.handle === authorHandle.trim().toLowerCase();
}
```

호출부 ([`src/messenger/discord-adapter.ts:149`](../../src/messenger/discord-adapter.ts#L149)):

```ts
const authorHandle = (message.author.username ?? "").toLowerCase();
if (!isAuthorizedAuthor(channelName, authorHandle)) {
  await message.author.send(unauthorizedAuthorMessage(channelName, authorHandle));
  return;
}
```

비교 두 항:
- `parsed.handle` ← 채널명 `command-w1n` 에서 추출 → `w1n`
- `authorHandle` ← Discord `message.author.username` → `seungw1n`

두 값이 다르면 차단. **즉 author-guard 는 "Discord 사용자명 = SoloSquad handle" 을 *암묵적 invariant* 로 가정**.

## 2. 이 가정이 왜 깨졌나 — v0.8 설계 회상

v0.8 §3.4 multi-user messenger 도입 시점의 의도 (당시 plan `docs/plan/v0.8-multiuser-messenger.md`):

- 1차 방어: 메신저 ACL (Discord 채널 권한). 봇이 다른 사용자 채널에 *초대 자체* 안 받음.
- 2차 방어 (author-guard): 사용자가 *실수로* 다른 사람 채널에 초대받았을 때 봇이 거기서 *응답 안 하게* 함.

당시 가정:
1. 솔로 founder 본인이 자기 워크스페이스 만듦 → user yaml `handle` 도 본인이 정함
2. 본인이 Discord 채널 자동 생성 → 본인이 그 채널에 메시지 발사
3. **본인 = 본인이므로 닉네임 = handle 일 거다**

**가정 깨지는 시나리오들** — 본 incident 외에도 다수:
- Discord 사용자명을 본명/별명/실명으로 길게 쓰는 사용자 (대다수)
- SoloSquad handle 은 짧고 기억하기 쉽게 정한 사용자 (대다수)
- Discord 가 2023 unique username 도입 후 username 변경 정책 자유로워짐 → handle 과 다양화 가속
- Discord 글로벌 닉네임 (display name) 도입 — username 과 표시 이름이 또 별개
- Slack 어댑터에서도 동일 — Slack `user.profile.real_name` ≠ Slack `user.name` ≠ SoloSquad handle

→ **솔로 사용자 단일 시나리오에서도 false positive 가 기본값**.

## 3. 해결 옵션 — 즉시·중기·근본

### 3.1 옵션 A — 사용자가 두 값을 *수동 align* (즉시 우회)

**액션**: Discord 사용자명을 `w1n` 으로 변경, 또는 SoloSquad user yaml 의 `handle: w1n` 을 `handle: seungw1n` 으로 변경 + 채널 재생성.

**장점**: 코드 변경 0, 지금 당장 해소.

**단점**:
- 사용자에게 *"본명 username 못 쓴다"* 강요
- *모든 신규 사용자*가 init 직후 같은 함정에 빠짐 (default false positive)
- 문서로 안내해도 onboarding friction 1단계 추가

**판정**: 본 incident 의 단발 해소엔 OK. *반복 발생 차단엔 부족*.

### 3.2 옵션 B — user yaml 에 `discord_username` 필드 별도 (중기 fix)

**스키마 변경** ([`src/bot/user-registry.ts`](../../src/bot/user-registry.ts) 의 `UserYaml` 타입):

```yaml
handle: w1n                    # 기존 — 채널명 + 내부 식별
discord_username: seungw1n     # 신규 — author-guard 비교 대상
discord_user_id: "123456789"   # 신규 — 영구 식별자 (username 변경 안전)
```

**author-guard 변경**:
```ts
export function isAuthorizedAuthor(
  channelName: string,
  authorHandle: string,
  authorId: string,           // 신규 인자
  registry: UserRegistry,     // 신규 인자
): boolean {
  const parsed = parseChannelName(channelName);
  if (!parsed) return true;
  // 채널 owner 의 user yaml 을 찾아 discord_user_id 또는 discord_username 비교
  const owner = registry.findByHandle(parsed.handle);
  if (!owner) return false;
  if (owner.discord_user_id) return owner.discord_user_id === authorId;
  return (owner.discord_username ?? owner.handle) === authorHandle.trim().toLowerCase();
}
```

**init wizard 변경** ([`src/cli/init.ts`](../../src/cli/init.ts) Step 5.2 user identification):
- 신규 사용자: `discord_username` 입력 prompt 1줄 추가 (default = handle 값 그대로)
- 또는 봇이 첫 메시지 받을 때 *자동 학습* — author 의 Discord ID 를 yaml 에 백필

**migration**: 기존 user yaml 들에 `discord_username` 누락 → migration 이 *handle 값으로 자동 채움* (기존 동작 보존). idempotent.

**장점**:
- 본 incident 같은 false positive 0
- Discord 사용자명 변경에도 안전 (id 기반)
- additive 스키마 (api-stability §schema "additive 는 minor") → v1.1.0 슬롯 가능
- author-guard 의 *defense-in-depth 의미* 유지 (남의 채널 초대 시나리오는 여전히 차단)

**단점**:
- user yaml schema 1 필드 추가 → migration script 1건
- init wizard 흐름 +1 prompt (또는 자동 학습 분기)
- author-guard signature 변경 → 호출부 1군데 ([`src/messenger/discord-adapter.ts:149`](../../src/messenger/discord-adapter.ts#L149)) + Slack 어댑터 동일 위치 (slack 은 post-v1.0 슬롯이지만 코드는 살아 있음)
- 신규 테스트 catcher 필요

**판정**: **권장안**. 본 ideation 의 default 채택안.

### 3.3 옵션 C — author-guard 자체를 제거 (근본 fix)

**근거**: 메신저 ACL 이 *1차 방어*. author-guard 는 *2차 방어*. 1차가 견고하면 2차 불필요.
- Discord: 채널 권한이 명시적. 봇이 다른 사용자 채널에 초대되는 시나리오 = 사용자가 의도적으로 잘못 초대해야만 발생.
- Slack: 채널 멤버십이 명시적. 동일.

**삭제 대상**: `src/bot/author-guard.ts` + Discord/Slack 어댑터의 호출 1군데씩.

**장점**:
- 코드 줄음. false positive 영구 0.
- "Discord 사용자명" 이라는 *변동 가능한 식별자* 에 의존 안 함.
- 옵션 B 의 schema 변경 + migration 불필요.

**단점**:
- 사용자가 *실수로* 다른 사람 채널에 초대받았을 때 봇이 거기서 응답해버림 → 정보 유출 위험 (남의 PRD 가 노출되는 식)
- v0.8 plan 의 정직성 promise (`defense in depth`) 와 충돌
- 멀티-유저 (한 organisation 안에 사람 여러 명) 시나리오에서 위험 표면 증가 — *솔로 founder 단일 사용 시나리오에선 위험 0 이지만 멀티 사용자 시나리오는 v0.8 의 명시 지원 범위*

**판정**: 솔로 단독 사용엔 정답에 가까움. 멀티-사용자 가능성 (Adelie Squad 의 squad 단위 운영) 고려하면 옵션 B 가 안전.

### 3.4 옵션 비교표

| 항목 | A — 수동 align | **B — discord_username 별도 (권장)** | C — author-guard 제거 |
|---|---|---|---|
| 코드 변경 | 0 | user-registry + author-guard + init + migration | author-guard.ts 삭제 + 호출부 2 |
| Schema 변경 | 0 | additive (필드 1) | 0 |
| Migration | 0 | bump + 자동 백필 | 0 |
| 신규 false positive 차단 | ❌ (반복 발생) | ✅ | ✅ |
| 멀티-사용자 보안 | 유지 | 유지 | 약화 |
| Slack 어댑터 영향 | 0 | 호출부 동일 변경 | 호출부 1 삭제 |
| 슬롯 | 즉시 | v1.0.2 patch (additive 스키마) or v1.1.0 | v1.1.0 (의미적 surface 변경) |
| 사용자 onboarding 영향 | +1 안내 문구 | init wizard +1 prompt 또는 자동 학습 | 0 |

## 4. 슬롯 / 버전 라벨 — 결정 필요 항목

### 4.1 라벨 후보

- **v1.0.2 patch** — additive 스키마 + 동작 변경은 *false positive 차단* (사용자 가시 *기능 추가* 아니라 *정직성 회복*). api-stability 정책상 "버그 수정" 으로 해석 가능. 단, additive 스키마는 minor 라는 엄격 해석도 있음 → 해석 차이.
- **v1.1.0 minor** — additive 스키마를 엄격하게 minor 로 해석. 동시에 v1.1 의 *대시보드 상호작용* 슬롯 (`docs/plan/v1.1-dashboard-interaction.md`) 과 묶기엔 무관한 주제 — 별 release 가 정합.
- **v1.0.x → v1.1 사이 별 minor (v1.0.5 등)** — patch 와 minor 사이 회색지대 회피, 단독 minor 로 라벨 — 단 SemVer 정의상 *v1.0.x 는 v1.0.0 의 patch 시리즈* 임.

### 4.2 권고 — v1.0.2

- 사용자 가시 *새 기능* 0 (CLI 명령 / 메신저 UX 동일)
- 동작 변경 = 기존 false positive 차단 = 버그 수정
- additive 스키마는 사용자 데이터 *추가만* 하므로 *후방 호환 100%*
- api-stability §schema "additive 는 minor" 는 *외부 소비자가 새 필드를 의존* 할 때의 promise; 본 케이스는 *내부 표면* — 사용자가 직접 yaml 안 들춰봄

단 본 결정은 *v1.0.1 publish 안정화* 후 본 ideation 으로 추가 논의 → plan 승격 시점에 재확정.

## 5. 작업 표면 — plan 승격 시 예상 스코프

옵션 B 채택 가정:

| 파일 | 변경 |
|---|---|
| `src/bot/user-registry.ts` | `UserYaml` 타입에 `discord_username?: string` + `discord_user_id?: string` 추가 |
| `src/bot/author-guard.ts` | signature 확장 — `authorId` + `registry` 인자 추가, 비교 로직 갱신 |
| `src/messenger/discord-adapter.ts:149` | `isAuthorizedAuthor` 호출에 `message.author.id` + registry 인스턴스 전달 |
| `src/messenger/slack-adapter.ts` | 동일 호출부 (Slack 은 post-v1.0 슬롯이나 코드 살아 있음) |
| `src/cli/init.ts` Step 5.2 | 신규 사용자에 Discord username/id 자동 학습 (첫 메시지 시 yaml 백필) 또는 prompt 1줄 |
| `src/migrations/scripts/1.0.1-to-1.0.2.ts` | bump + 기존 user yaml 에 `discord_username = handle` 자동 채움 (보존적) |
| `src/migrations/index.ts` | 신규 migration 등록 |
| `test/v1.0.2-author-guard.test.ts` | username 매칭, id 매칭 우선, 백필 idempotent |
| `docs/plan/v1.0.2-author-guard-decoupling.md` | 본 ideation 의 plan 승격본 |
| 4 release-critical docs | v1.0.2 멘션 갱신 |

예상 LOC: 추가 ~150, 변경 ~30, 테스트 +5 cases.

## 6. 결정 대기 항목 (사용자와 다음 라운드 논의)

1. **라벨** — v1.0.2 patch 인지 v1.1.0 minor 인지 (§4)
2. **옵션 B vs C** — 멀티-유저 시나리오를 실제 지원할 가능성이 있는지 (squad-운영). 그렇다면 B, 솔로 전용이면 C 도 검토 가치
3. **init wizard prompt vs 자동 학습** — onboarding 흐름에 +1 prompt 추가할지, 첫 메시지에서 silent 백필할지
4. **Slack 어댑터 함께 fix 할지** — post-v1.0 슬롯이지만 코드 살아 있음. 일관성 유지 vs scope 최소화

## 7. 임시 우회 — v1.0.1 사용자 가이드 안내문 (즉시 사용)

본 fix 가 ship 되기 전까지 v1.0.1 사용자가 본 incident 만나면:

> SoloSquad handle 이 Discord 사용자명과 다르면 봇이 *defense-in-depth* author-guard 로 본인 메시지를 차단합니다 (v1.0.x 알려진 제약, v1.0.2 또는 v1.1 에서 수정 예정). 즉시 우회:
> - Discord 사용자명을 SoloSquad handle 과 동일하게 변경 (Discord 설정 → My Account → Username)
> - 또는 SoloSquad handle 을 Discord 사용자명과 동일하게 변경 — `<workspace>/<org>/.solosquad/users/<handle>.yaml` 의 `handle` 키 + 파일명 둘 다 변경, Discord `command-<옛>` / `works-<옛>` 채널 삭제 후 봇 재시작

이 안내문은 v1.0.1 CHANGELOG `[1.0.1]` 섹션에 *Known limitations* 절로 별도 박제 후보 — 다만 v1.0.1 은 이미 release 커밋 완료된 상태이므로 *추가 커밋 없이* 본 ideation doc 로 추적, plan 승격 시점에 CHANGELOG 보완 결정.
