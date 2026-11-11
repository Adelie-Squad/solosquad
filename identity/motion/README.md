# motion/ — 펭귄 모션

두 갈래다. **클립**은 `penguin.glb` 안에 든 동작(사무실 · 랜딩이 같이 쓴다), **랜딩 전용 모션**은 클립이 아니라 웹 코드가 프레임마다 뼈를 움직이는 것이다.

## 클립 (`penguin.glb`, 7개)

원본 [`assets/office/scripts/anim.py`](../../assets/office/scripts/anim.py) `CLIPS` + 기준 자세 [`penguin.py`](../../assets/office/scripts/penguin.py) `POSES`.
30 fps · 모두 이음매 없는 반복(채널마다 사인파 합, 주기가 정수라 첫 프레임 = 마지막 프레임) · **첫 프레임 = 그 상태를 대표하는 자세**(모션 줄이기면 웹이 이 프레임에 멈춘다, `web/src/office/motion.ts` `STILL_TIME`).
상태가 바뀌면 0.25초에 걸쳐 섞는다(`CROSSFADE`). 에이전트마다 시작 위상이 달라 한 사무실이 같이 숨쉬지 않는다(`phaseOf`).

미리보기: `clips/<클립>/<클립>-front.webp` · `-three-quarter.webp`(움직이는 WebP, 15 fps = 30 fps 의 한 칸 건너, 360px) · `<클립>-keys.webp`(반복 한 번을 6등분한 키 포즈, 3/4).

| 클립 | 길이 · 반복 | 무엇을 보여주나 (기준 자세 + 움직임) | 쓰는 곳 |
|---|---|---|---|
| `idle` | 2 s · 반복 | 기본 자세. 몸이 2.5 % 길어지고 1.2 % 좁아지는 느린 숨 · 머리 2° 끄덕임 | 사무실 `idle`(낮). **랜딩의 모든 장면**(`ACT_CLIP` — 날개는 코드가 따로 움직인다) |
| `idle_doze` | 2 s · 반복 | 고개 −20° 숙이고 몸 −4° · 옆 3°. 머리 −5° 더 끄덕이며 졸기, 느린 숨 | 사무실 저녁(어두운 테마)의 `idle` (`clipFor`) — 스탠드 · 화면 꺼짐 |
| `thinking` | 2 s · 반복 | 고개 14° 들고 옆으로 10° · 오른 날개 −62° 앞으로(턱 괴기). 몸 좌우 ±5° 흔들기 · 고개 ±8° 둘러보기 · 날개 4° 두 번 톡톡 | 사무실 `thinking` — 일하는 중인데 4초 넘게 출력이 없을 때 |
| `typing` | 1 s · 반복 | 몸 −9° · 고개 −6° 숙이고 두 날개 −72° 앞으로(책상 위). 날개 ±9° 번갈아 1초에 3번 · 몸 4 mm 들썩 6번 | 사무실 `typing` — 4초 안에 글 · 도구 단계가 나왔을 때. 랜딩은 쓰지 않는다(랜딩 크기에서 떨림으로 보여서, `acting.ts` 주석) |
| `waiting` | 1 s · 반복 | 오른 날개 150° 바깥으로 들기 · 고개 6°. 날개 ±18° 흔들기 2번 · 0–3.6 cm 작은 뜀 2번 | 사무실 `waiting` — 이 에이전트가 사람 승인을 기다릴 때(최우선) |
| `done` | 1 s · 반복 | 두 날개 ±140° 위로 · 고개 10° · 몸 5 cm 들림. 한 번 뛰어오르고(0–10 cm) 내려앉을 때 8 % 납작 · 날개 ±12° 두 번 | 사무실 `done` — 실행이 끝나고 10초 동안(`DONE_MS`), 그 뒤 `idle` |
| `error` | 2 s · 반복 | 고개 −26° · 몸 −8° 푹 숙이고 날개 6° 늘어뜨림. 거의 멈춘 채 무거운 숨(1.2 %) · 고개 1.5° | 사무실 `error` — 실패 뒤 60초 또는 다시 일할 때까지(`ERROR_MS`) |

상태 판정은 `web/src/office/state.ts` `agentStatus`(승인 대기 > 일하는 중(typing / thinking) > 끝남(done / error) > idle).

## 랜딩 전용 모션 (코드, 클립 아님)

랜딩은 `idle` 클립 위에서 **날개 · 몸 위치를 코드가 직접** 움직인다(`web/src/landing/MascotCanvas.tsx` — 날개 끝이 화면 위 목표점을 향하도록 `rig.ts` `reach`). 시간표는 `acting.ts` · `staging.ts` 의 상수이고 테스트가 같은 값을 읽는다.
그림은 랜딩 작업 때 찍은 프레임 시트(1440 × 900, 라이트, 2026-11-10 01:20–01:22)를 WebP 로 옮겨 왔다: `landing/*.webp`.
원본 프레임은 `/Users/seungw1n/Dev/adelie/solosquad-shots/v2.1-landing-intro/final/`(저장소 밖).

| 모션 | 시간 | 코드 | 그림 |
|---|---|---|---|
| **첫 등장 — 공 → 펭귄 바운스** | 1150 ms: 떨어짐 340 · 닿아 납작(15 %) 120 · 늘어나며 펭귄이 됨(+14 %) 240 · 되튐(−4 %) 180 · 자리잡기 270. 키의 30 % 위에서 떨어진다. 얼굴 · 부리 · 날개 · 발은 늘어날 때 공에서 자라난다. 페이지당 한 번, 모션 줄이기면 없음 | `web/src/landing/intro.ts` · `morph.ts` — **브랜치 `feat/v2.1-landing-intro`(커밋 `11d26c3`), 아직 이 브랜치 · main 에 없음** | `landing/intro-bounce.webp` (0–1150 ms 17칸) |
| 장면 사이 이동 | 720 ms (`MOVE_MS`) easeInOutCubic · 키의 5 % 작은 뜀 · 가는 쪽으로 0.07 rad 기울기. 장면 도착 후 840 ms(`ACT_DELAY_MS`) 뒤 연기 시작 | `staging.ts` `moveAt` | — |
| **타자 치는 날개**(hero) | 두 날개가 번갈아 초당 3.5번(`STROKE_RATE`, 한도 3–4) · 깊이 키의 3 % · 들어올림 1.2 % · sin² 곡선. 프롬프트 창이 입력 중일 때만, 들고 날 때 부드럽게 섞음 | `staging.ts` `strokeAt` · `MascotCanvas.tsx` | `landing/hero-typing.webp` |
| **날개 뻗기 — 요청 건네기**(what) | 날개가 카드 1 로 650 ms · 350 ms 머묾 · 600 ms 돌아옴. 카드는 1100 ms 마다 하나씩 켜짐(3장) | `acting.ts` `RELAY` · `relayHand` | `landing/what-reach.webp` |
| **두루마리 펼치기**(team) | 종이가 1600 ms 에 걸쳐 내려옴(`UNROLL_MS`) · 손잡이 쥔 날개가 700 ms 동안 키의 2 % 당김(`tugAt`) · 몸은 종이 뒤에서 왼쪽으로 기울어 얼굴만 내밈 | `acting.ts` · `Acts.tsx` · `landing.css --unroll` | `landing/team-unroll.webp` (펼쳐진 뒤의 12칸) |
| **도장 찍기**(control) | 들어올림 620 · 멈춤 280 · 내려찍기 150 · 누름 240 · 올림 620 ms(총 1910). 찍는 순간(1050 ms) 버튼 눌림, +260 ms 승인 표시. 몸 4 % 납작(320 ms) — 페이지에서 유일한 몸 변형 | `acting.ts` `STAMP` · `squashAt` · `props.ts` `prop.stamp` | `landing/control-stamp.webp` |
| **손 흔들기**(start) | 1.2 Hz 로 2100 ms(두 번 반) · 400 ms 에 들어올림 · 500 ms 에 내림 · 옆으로 키의 6 % | `acting.ts` `waveAt` | `landing/start-wave.webp` |

모든 반복 모션은 `prefers-reduced-motion: reduce` 에서 꺼진다(DESIGN.md `## 모션`). 2D 마스코트의 상시 모션(둥실 4 s · 깜빡임 5 s 이하 · 첫 인사 날개 3번)은 DESIGN.md 규칙이고, 이 기록에는 그림이 없다.
