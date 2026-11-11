# 펭귄 캐릭터 현황 (2026-11-10 기준)

> 지금 Blender 로 만든 펭귄을 **있는 그대로** 적은 기록이다. 다시 디자인하기 전에 "지금 무엇이 어떻게 되어 있나"를 보려고 둔다.
> 값은 모두 아래 원본에서 옮겼다(기억으로 쓰지 않음). 값을 바꾸려면 원본을 고치고, 이 문서를 다시 맞춘다.
>
> - 3D: [`assets/office/scripts/penguin.py`](../../assets/office/scripts/penguin.py) · [`lib.py`](../../assets/office/scripts/lib.py) (팔레트) · [`props.py`](../../assets/office/scripts/props.py) · [`anim.py`](../../assets/office/scripts/anim.py)
> - 2D: [`web/src/characters/penguinShape.ts`](../../web/src/characters/penguinShape.ts) · [`PenguinIcon.tsx`](../../web/src/characters/PenguinIcon.tsx) · [`colors.ts`](../../web/src/characters/colors.ts) · [`roster.ts`](../../web/src/characters/roster.ts)
> - 규격: DESIGN.md `## 에이전트 캐릭터` · [`docs/design/office-asset-contract.md`](../../docs/design/office-asset-contract.md) §2 · §5 · §6 · [`assets/office/README.md`](../../assets/office/README.md)
> - 기준 커밋: `60f182f` feat(v2.1): redraw the penguin (브랜치 `feat/v2.1-penguin-redesign`, 아직 main 아님)

## 1. 비율

3D 는 Blender 단위 = 1 m, 앉은 자세로 만든다(원점 = 의자에 닿는 엉덩이, 정면 = −Y, 펭귄의 오른쪽 = −X).
얼굴 부분 좌표는 2D 아이콘 단위(viewBox 40, y 아래로)로 적고 **0.017 m/단위**, 눈 중심 z **0.49 m** 로 3D 에 옮긴다(`penguin.py` `_S` · `EYE_Z` · `icon_to_xz`).

| 항목 | 값 | 출처 |
|---|---|---|
| 앉은 키 | **0.70 m** (2026-11-10 0.60 → 0.70) | `penguin.py` `H` · 규격 §2 |
| 몸 폭(날개 빼고) | **0.44 m** | `W` |
| 폭(날개 포함) | 0.48 m | 규격 §2 · README |
| 몸 깊이 | **0.30 m** | `D` |
| 깊이(앞판 포함 · 발끝까지) | 0.32 m · 0.35 m | 규격 §2 |
| 키 : 폭 | 1.59 : 1 (DESIGN 은 "≈ 1.6 : 1") | 0.70 / 0.44 |
| 깊이 : 폭 | 0.68 | 0.30 / 0.44 |
| 몸 단면 | 둥근 사각(superellipse p 2.6, 18 % 섞음) · 아래 0.30 높이에서 8 % 불룩 · 위 0.45–0.85 에서 10 % 좁아짐 | `_profile` · `body_mesh` |
| 눈 중심 | z 0.49 m (키의 70 %) · x ±0.065 m (아이콘 x 16.2 / 23.8) | `EYES` |
| 볼 중심 | z 0.422 m · x ±0.099 m (아이콘 14.2 / 25.8, y 22.4) | `CHEEKS` |
| 부리 중심 | z 0.43 m (아이콘 y 21.9, 윗 · 아랫부리 경계) | `BEAK` |
| 흰 앞판 꼭대기 | z 0.616 m (아이콘 y 11.0) | `FRONT` |
| 어깨(날개 뿌리) | z 0.42 m (키의 60 %) · x ±0.19 m | `SHOULDER` |
| 목(몸 → 머리 피부 섞임 중심) | z 0.308 m (키의 44 %), ±0.08 m 에 걸쳐 섞임 | `NECK_Z` · `_skin` |
| 가슴 소켓 | z 0.231 m (키의 33 %) | `CHEST_Z` |
| 삼각형 | 7,368 (예산 8k) | README |

**얼굴 비율** — 기준 = 눈 높이에서 잰 흰 앞판 폭 17.5 단위(= 0.2975 m, 몸 폭의 68 %). DESIGN.md 와 `web/test/penguin-icon.test.tsx` 가 같은 값을 쓴다.

| 부분 | 아이콘 단위 | 3D (m) | 앞판 폭 대비 |
|---|---|---|---|
| 눈 지름 | 3.8 (r 1.9) | 0.065 | **0.22** |
| 볼 지름 | 3.0 (r 1.5) | 0.051 | **0.17** |
| 부리 폭 | 5.2 (반폭 2.6) | 0.088 | **0.30** |
| 부리 높이 | 5.6 (위 2.6 + 아래 3.0) | 0.095 | **0.32** (윗 0.15 · 아랫 0.17) |
| 눈 사이(중심 간) | 7.6 | 0.129 | 0.43 |
| 앞판 꼭대기 ↔ 눈 중심 | 7.4 | 0.126 | 0.42 |

## 2. 부분 목록 (3D)

모든 재질 = 무광 roughness 0.9 · metallic 0 · 텍스처 없음(`lib.material`). 재질 이름 = 팔레트 키([`palette.json`](palette.json)).
웹이 테마별로 바꾸는 것은 `penguin.body` 하나뿐이다(저녁 `#474855`).

| 부분 | 형태 · 크기 | 재질 | 라이트 | 저녁 |
|---|---|---|---|---|
| 몸 | UV 구(40 × 26)를 서양배 모양으로 다시 맞춤 · 바닥은 부드럽게 평평(엉덩이로 앉음) | `penguin.body` | `#2B2A26` | **`#474855`** |
| 흰 앞판 | 몸 위에 덧댄 펠트, 두께 0.010 m(가운데로 갈수록 도톰). 이마 아치 → 눈 옆 볼록 곡선 → 배 오목 → 바닥 밑 194° 까지 감쌈(극좌표 중심 z 0.26) | `penguin.face` | `#F3F0EA` | 같음 |
| 앞판 박음질 | 앞판 가장자리 0.015 m 안쪽 점선. 조각 = 작은 납작 캡슐(5 × 3 구), 길이 0.012 · 간격 0.008 · 굵기 r 0.0034, 반쯤 묻힘. 앞판이 바닥 밑으로 꺾이는 150° 에서 멈춤 | `penguin.stitch` | `#151410` | 같음 |
| 눈 | 정원 펠트 원판 r 0.032 m · 두께 0.008 · 앞판에서 0.001 띄움 (16 × 6 분할) | `penguin.eye` | `#151410` | 같음 |
| 볼 | 정원 펠트 원판 r 0.026 m · 두께 0.004 (16 × 6 분할) | `penguin.cheek` | `#E01FAE` | 같음 |
| 부리 | 앞에서 보면 마름모(반폭 0.044 · 위 0.044 · 아래 0.051 m, 모서리 superellipse p 1.18) · 도톰함 0.016 · 윗부리가 더 나옴(아랫부리 0.82배) · 가운데 45 % 주름 | `penguin.beak` | `#FBF9F4` | 같음 |
| 부리 박음질 | 부리 외곽의 80 % 크기 선 위 점선, 길이 0.0062 · 간격 0.0042 · r 0.0022 | `penguin.stitch` | `#151410` | 같음 |
| 날개 | 납작한 타원체 0.068 × 0.17 × 0.31 m, 몸 옆 x ±0.198 · z 0.273 · 바깥으로 8° 기울임 | `penguin.body` | `#2B2A26` | `#474855` |
| 발 | 납작한 타원체 0.104 × 0.136 × 0.044 m, x ±0.08 · y −0.12(앞) · z 0.022 | `penguin.feet` | `#151410` | 같음 |

조명(렌더 기준): 라이트 = 하늘 `#FFFFFF` ×0.72 + 해 `#FFF6E8` ×1.5 · 저녁 = 하늘 `#3A4566` ×0.9 + 뒤 위에서 달빛 테두리 `#9FB2E8` ×2.5 (`frames.py`). 이 기록의 저녁 렌더는 거기에 화면 빛 대신 앞에서 `#8FB8FF` 30 W 채움광을 더했다(일하는 에이전트, `identity_renders.py theme()`).

## 3. 뼈 · 소켓 (`penguin_rig`)

뼈 로컬 회전: 몸 · 머리 X− = 앞으로 숙임 · 날개 X− = 앞으로 휘두름 · 날개 바깥으로 = L Z− / R Z+. 몸 위치 Y = 위.

| 뼈 | 머리 → 꼬리 (m, Blender) | 부모 | 변형 |
|---|---|---|---|
| `root` | (0, 0, 0) → (0, 0.12, 0) | — | 안 함 |
| `body` | (0, 0, 0.02) → (0, 0, 0.308) | root | 함 |
| `head` | (0, 0, 0.308) → (0, 0, 0.70) | body | 함 |
| `wing.L` / `wing.R` | (±0.19, 0, 0.42) → (±0.205, −0.01, 0.133) | body | 함(날개 메시 전부, 단단히) |
| `foot.L` / `foot.R` | (±0.08, −0.14, 0.022) → (±0.08, −0.21, 0.022) | root | 함(발 메시 전부) |
| `socket.head` | (0, 0, 0.70) → (0, 0, 0.78) | head | 안 함 |
| `socket.chest` | (0, −0.15, 0.231) → (0, −0.23, 0.231) | body | 안 함 |
| `socket.hand.R` | 오른 날개 끝 (−0.205, −0.01, 0.133) → 앞으로 0.08 | wing.R | 안 함 |

피부: 날개 · 발은 한 뼈에 100 %. 나머지(몸 · 앞판 · 눈 · 볼 · 부리 · 박음질)는 z 0.228–0.388 사이에서 `body` → `head` 로 부드럽게 넘어간다.
즉 `head` 뼈는 몸 중간(0.31 m)에서 꺾여 **위쪽 절반 전체**를 움직인다(따로 된 목 · 머리 모양은 없다).

**역할 소품** — 메시 `prop.<에이전트 id>.<부분>`, 사용자 정의 속성 `socket`(`props.py` `BUILDERS` · `AGENT_PROPS`). 팀 색 부분은 `team_accent`.

| 에이전트(팀) | 소품 → 소켓 |
|---|---|
| chief (core) | crown → head · bowtie → chest |
| product-manager (product) | clipboard → hand.R |
| product-designer (product) | beret → head |
| researcher (product) | glasses(검정 테) → head |
| data-analyst (product) | chart → hand.R |
| frontend-engineer (engineering) | beanie → head |
| backend-engineer (engineering) | headset → head |
| data-engineer (engineering) | cube → hand.R |
| infra (engineering) | hardhat → head · shield → chest |
| quality-assurance (engineering) | magnifier → hand.R |
| business-strategy (business) | tie → chest |
| sales (business) | card → hand.R |
| finance (business) | glasses(금테) → head · calculator → hand.R |
| marketer (brand) | megaphone → hand.R |
| creative (brand) | brush → hand.R |
| (표에 없는 역할) | `prop.scarf` → chest, 팀 색 |

소품 삼각형 156(shield) – 780(hardhat), 예산 각 800.

## 4. 동작 클립

7개, 30 fps, 첫 프레임 = 마지막 프레임(사인파 합) — [`../motion/README.md`](../motion/README.md).

## 5. 2D 아이콘

[`2d/`](2d/) 의 SVG 는 `node web/scripts/identity-icons.mjs` 로 웹 컴포넌트를 그대로 그린 것이다.

- **틀**: viewBox 40 × 40. 몸 전체는 y 5(머리 꼭대기) → 48(바닥) · 발까지 49.3.
- **아이콘**(크기 20 / 28 / 40, 모달 머리 64): 정면 상반신, 반지름 18.6 원으로 잘림 + 팀 색 테두리(r 18.8, 굵기 2.2). 가슴 아래는 안 보이고 발도 없다. 역할 소품을 얹는다.
- **마스코트**: 소품 · 테두리 없이 전신(`FULL_VIEW` = translate(2.8 −3.3) scale(0.86)), 검은 발까지.
- **얼굴 좌표**: 3D 와 같은 수(`FRONT` · `EYES` · `CHEEKS` · `BEAK`). 몸 실루엣 `BODY` · 날개 `FLIPPERS` · 발 `FEET` 은 2D 에서 따로 그린 경로다(3D 에서 옮기지 않음).
- **윤곽선**: 몸 · 날개 · 소품에 잉크 선 `#111008` 0.9 단위(3D 에는 윤곽선 없음). 흰 앞판 · 눈 · 볼 · 부리에는 선 없음.
- **박음질**(`stitchStyle`): 40px 이상 = 점선(앞판 0.5 굵기 · 0.9/0.7, 부리 0.45 · 0.62/0.45) · 40px 미만 = 한 줄 실선(앞판 0.55, 부리 28px 0.6 · 20px 0.75).
- **부리 이음선**: `#C9BD98` 0.45 가로선.
- **색**: `PENGUIN_2D` — 몸 `#2B2A26` · 날개 `#3D3B35` · 앞판 `#F3F0EA` · 눈 `#151410` · 부리 `#FBF9F4` · 박음질 `#151410` · 발 `#151410` · 볼 `var(--cheek)`(라이트 `#E01FAE` · 다크 `#F25CC8`). 다크 테마에서도 몸색은 그대로다(2D 에는 저녁 몸색이 없다).

## 6. 알려진 문제 · 열린 질문

렌더를 보고 적은 것. 고칠지 말지는 사용자가 정한다.

1. **눈 · 볼이 각져 보인다** — 원판이 16 × 6 분할이라 얼굴 가까이에서 16각형이 보인다(`face-front-*.webp`). 정원이어야 한다(DESIGN).
2. **박음질 조각이 육각형 칩처럼 보인다** — 조각마다 5 × 3 구라 가까이서 실이 아니라 작은 돌처럼 보인다.
3. **발이 몸에서 떨어져 앞에 떠 있다** — 옆모습(`side-left-*`)에서 발과 배 사이에 틈이 보인다. 발 중심 y −0.12 가 몸 앞면보다 앞이다.
4. **날개가 거의 안 보인다** — 몸 옆에 붙은 납작한 타원이라 정면 실루엣은 그냥 달걀이다. 펭귄으로 읽히는 것이 날개 · 부리보다 흰 앞판에 기대고 있다.
5. **"납작한 봉제 인형"이 아니다** — 깊이가 폭의 68 %(0.30 / 0.44)라 옆에서 보면 두툼한 달걀이다. 키링 같은 납작함을 원하면 깊이를 줄여야 한다.
6. **흰 앞판이 너무 넓다?** — 눈 높이 앞판 폭이 몸 폭의 68 % 라 검정은 테두리처럼 남는다. 정면에서 "검은 후드를 쓴 흰 달걀"로 읽힌다.
7. **목이 없다** — `head` 뼈가 키의 44 %(0.31 m)에서 꺾여, `idle_doze` · `error` 의 고개 숙임이 상체 전체를 접는다.
8. **넥타이 · 나비넥타이가 배에 있다** — 가슴 소켓이 z 0.23(키의 33 %)이라 목이 아니라 배꼽 높이에 붙는다(`props/chief.webp`, `business-strategy.webp`).
9. **2D 와 3D 몸 비율이 다르다** — 얼굴 좌표만 공유하고, 2D 몸 `BODY` 는 1.71 : 1(43 × 25.2 단위), 3D 는 1.59 : 1. 2D 에만 윤곽선이 있다.
10. **저녁 몸색이 남색으로 보인다** — `#474855` 에 파란 채움광 · 달빛이 더해져 검정 펭귄보다 푸른 회색으로 읽힌다(`*-evening`).
11. **뒷모습 · 위 모습에 특징이 없다** — 꼬리 · 등 무늬가 없어 뒤(`back-*`)는 검은 덩어리 하나다.
12. **작은 아이콘(20px)에서 부리가 흐려진다?** — 흰 앞판 위 흰 부리를 박음질 실선만으로 구분한다. 20 / 28px 에서 읽히는지 확인 필요.
13. **소품 위치** — 왕관이 머리 꼭대기에 얹혀 떠 보이고, 손 소품(클립보드 · 차트 등)은 날개 끝 앞 0.05 m 에 떠 있다(날개가 쥐는 모양은 없다).
