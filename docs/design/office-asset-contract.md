# 사무실 3D 에셋 규격 (Blender → GLB → 웹)

> DESIGN.md `## 사무실 장면` v3(점토 스타일)의 **제작 절차**를 구체화한 규격이다. Blender 쪽(MCP for Blender 작업 세션)이 만든 결과물이
> 웹(React Three Fiber)에 손대지 않고 들어가도록, 이름 · 단위 · 구성 · 예산을 여기서 고정한다. 규격을 바꾸려면 이 문서를 먼저 고친다.
> 작성 2026-11-07.

## 1. 저장 위치

```
assets/office/
  scripts/build_kit.py        Blender Python — 방 조각 · 책상 세트 · 소품 · 조명을 빈 장면에서 만들어 .blend 로 저장
  scripts/build_penguin.py    Blender Python — (v2 펭귄, 기록용) 펭귄 몸 · 리그 · 동작 · 역할 소품을 만들어 .blend 로 저장
  scripts/penguin_v3.py       Blender Python — v3 펭귄 원본(확정 디자인, 12차 — SDF · 경첩 날개 · 필렛)
  scripts/penguin_prod.py     Blender Python — v3 를 웹 에셋으로: 메시 · 색 영역 · 구운 텍스처 · 필렛 모프 · 리그 · 소품 · 클립
  scripts/penguin_prod_qa.py  Blender Python — 동작 게이트(간격 · 궤적 · 관절 한계, 모든 클립) → qa/penguin-gate.md
  scripts/penguin_2d.py       Blender Python — 같은 모델의 정면 → web/src/characters/penguinShape.ts 값
  scripts/export.py           Blender Python — .blend 를 GLB 로 내보내고 압축까지
  src/                        .blend 작업 파일 — 커밋하지 않음(.gitignore). build_*.py 로 언제든 다시 만든다
  export/office-kit.glb       웹이 읽는 결과물(커밋)
  export/penguin.glb
  frames/style-light.png      스타일 프레임(사용자 확정용, 커밋)
  frames/style-evening.png
  README.md                   다시 만드는 명령 · 확정된 팔레트 실측값
```

- **원본은 텍스트(빌드 스크립트)** 다(2026-11-07 — 이 맥에 Git LFS 가 없어 `.blend` 를 저장소에 두지 않기로). 형태 · 재질 · 리그 · 동작을 모두 `build_*.py` 가 빈 장면에서 만든다. 손으로 고친 것이 있으면 스크립트에 옮긴 뒤에만 결과물로 낸다.
- 다시 만들기(사람이 Blender 를 열지 않고도 같은 결과):
  - `blender -b -P assets/office/scripts/build_kit.py -- --save assets/office/src/office-kit.blend`
  - `blender -b -P assets/office/scripts/build_penguin.py -- --save assets/office/src/penguin.blend`
  - `blender -b assets/office/src/office-kit.blend -P assets/office/scripts/export.py -- --out assets/office/export` (펭귄도 같은 방식)
- 커밋하는 이진 파일은 `export/*.glb` · `frames/*.png` 뿐이다(예산 5 MB 안이라 LFS 없이 둔다).
- **외부 에셋 금지** — Poly Haven 등에서 내려받은 모델 · 텍스처 · HDRI 를 쓰지 않는다. 모든 형태 · 재질은 이 저장소의 스크립트가 만든다.

## 2. 단위 · 좌표 · 시점

- 1 Blender 단위 = 1 m. glTF 는 Y-up(Blender 의 Z-up 은 내보내기에서 변환).
- 바닥 타일 = 2 × 2 m. 벽 높이 2.4 m. 방은 타일을 붙여 넓힌다(웹이 인원에 맞춰 배치).
- 각 모듈의 원점 = 바닥 면 가운데. 앞(열린 쪽) = +Z(glTF 기준). 책상 세트는 앉는 사람이 +Z 를 본다.
- 기준 시점: 직교 · 위 30° · 옆 45°. 스타일 프레임은 이 시점으로 렌더한다.
- 펭귄 크기: 의자에 앉은 키 **0.70 m**(폭 0.48 날개 포함 · 몸 0.44 · 깊이 0.32 앞판 포함 · 발까지 0.35), 책상 상판 높이 0.72 m 에 날개가 닿는 비례. 0.55 m 이면 위 30° 시점에서 얼굴이 노트북 뚜껑에 가려져 0.60 m 로 올렸고(스타일 프레임 실측, 2026-11-07), 2026-11-10 몸을 위로 길쭉하게 다시 그리며 0.70 m 로 올렸다(DESIGN.md `## 에이전트 캐릭터`). 앉는 자리 · 의자 · 상판 높이는 그대로. **2026-11-25 v3**: 앉은 키(좌석 → 머리 꼭대기) 0.705 m · 폭 0.41 m(날개 빼고, 쉬는 날개 포함 0.64) · 깊이 0.295 m, 선 키 0.735 m.
- 축: Blender Z-up 에서 glTF +Z(열린 앞쪽, 앉은 에이전트가 보는 쪽) = Blender −Y. 벽은 Blender −X(왼쪽) · +Y(뒤).

## 3. 모듈 (office-kit.glb) — 루트 노드 이름 = 아래 이름 그대로

| 노드 | 내용 |
|---|---|
| `room.floor_tile` | 2 × 2 m 바닥 한 칸 |
| `room.wall_left` · `room.wall_back` | 2 m 벽 한 칸(두께 0.12) |
| `room.corner` | 두 벽이 만나는 모서리 기둥 |
| `desk.set` | 책상 + 의자 + 노트북(뚜껑 바깥에 스티커 면) — 팀원 자리 |
| `desk.chief` | Chief 단독 책상(조금 더 큼) |
| `lamp.desk` | 책상 스탠드 — 전구 메시 + 빛 위치 빈 노드 `lamp.desk.light` |
| `prop.plant` · `prop.shelf` · `prop.whiteboard` · `prop.sofa` · `prop.coffee_bar` | 공용 소품 |

- **벽 모듈의 원점** = 그 벽이 맞닿는 바닥 타일의 가운데. `room.wall_left` · `room.wall_back` · `room.corner` 는 그 타일의 `room.floor_tile` 과 **같은 위치**에 놓는다. 벽은 그 타일의 −X(왼쪽) 또는 뒤 가장자리 바깥에 선다. 바닥 타일은 모서리가 각지고 벽은 윗변만 둥글어서, 타일끼리 이음매 없이 붙는다.
- **앉는 자리**: 펭귄은 `desk.set` · `desk.chief` 의 로컬 Blender (0, +0.27, 0.42)(glTF 로는 위 0.42 m · −Z 쪽 0.27 m)에 앉는다. 의자 높이 0.42 m, 상판 0.72 m. 노트북 뚜껑 뒷면(`team_sticker` 원)이 카메라 쪽을 본다.
- **스탠드 자리**: `lamp.desk` 는 책상 뒤 왼쪽 모서리, 책상 로컬 Blender (−w/2 + 0.12, −0.02, 0.72)에 둔다. w = 0.96(`desk.set`) · 1.30(`desk.chief`). 빛 위치는 자식 빈 노드 `lamp.desk.light`.
- 모듈마다 메시는 재질 단위로 합친다(그리기 호출 줄이기).

## 4. 재질 이름 = 팔레트 키

웹은 재질을 **이름으로 찾아** 테마(라이트 · 저녁)별 색 · 발광을 바꿔 끼운다. 재질 색은 Blender 에서 확정 팔레트 값으로 두되, 이름이 틀리면 웹이 못 바꾼다.

| 재질 | 쓰는 곳 |
|---|---|
| `clay.wall` · `clay.floor` · `clay.furniture` · `clay.wood` · `clay.plant` | 방 · 가구 · 화분 |
| `clay.screen` | 노트북 화면(저녁에 웹이 발광을 켠다) |
| `clay.lamp_bulb` | 스탠드 전구(저녁에 웹이 발광을 켠다) |
| `team_sticker` | 노트북 뚜껑 스티커 — **웹이 팀 대표색으로 칠한다** |
| `team_accent` | 역할 소품의 팀 색 부분 — 웹이 팀 대표색으로 칠한다 |
| `penguin.body` · `penguin.face` · `penguin.cheek` · `penguin.eye` · `penguin.beak` · `penguin.feet` · `penguin.stitch` | 펭귄. 웹이 테마별로 바꾸는 것은 `penguin.body` 뿐이고 나머지는 고정색(흰 앞판 `#F3F0EA` · 눈 `#151410` · 볼 `#E01FAE` · 부리 흰색 `#FBF9F4` · 박음질 검정 `#151410` · 발 검정 `#151410`). v3(2026-11-25): 모든 펭귄 재질이 같은 UV 로 `penguin_detail`(색 텍스처) · `penguin_relief`(노멀 맵)를 쓴다 — `penguin.body` · `penguin.feet` 는 **재질 색 × 텍스처**(검은 영역의 텍셀은 곱하기 값 ≈ 1, 박음질 · 홈만 어둡게)라 웹이 몸색을 바꿔도 그대로 맞고, 나머지는 텍스처가 색 자체(재질 색 = 흰색). `penguin.stitch` 는 부리 테두리 파이핑(지오메트리) |
| `prop.<색 이름>` | 소품의 고정 색(예: `prop.gold` · `prop.black`) |

- 모든 재질 = 무광(roughness 0.8 이상) · metallic 0(glTF 기본값이 1 이므로 꼭 명시) · 텍스처 무늬 없음. 예외: 펭귄의 박음질 · 이음 홈 디테일(위 — 구운 텍스처 · 노멀 맵, 무늬가 아니라 봉제선).
- **모듈별 재질 인스턴스(AO 때문에)** — 구운 AO 는 모듈마다 다른데 재질은 여러 모듈이 같이 쓴다. 그래서 `office-kit.glb` 의 재질은 모듈마다 따로 두고 이름을 **`<팔레트 키>#<모듈>`** 로 짓는다(예: `clay.furniture#desk.set` · `team_sticker#desk.set`). AO 는 그 재질의 `occlusionTexture`(texCoord 1 = `uv_ao`)로 넣는다. 웹은 `name.split('#')[0]` 을 팔레트 키로 쓴다. 펭귄 · 역할 소품 재질은 AO 가 없으므로 `#` 없는 키 그대로(2026-11-07 결정).

## 5. 펭귄 (penguin.glb)

> **2026-11-25 — v3 펭귄**(확정 디자인 = `identity/_drafts/penguin-v3/` 12차, 원본 `scripts/penguin_v3.py`). 제품 GLB 는 `scripts/penguin_prod.py` 가 만든다(`export.py -- --only penguin`).

- 메시 `penguin` 하나(스킨 · 날개 노 · 눈 · 볼 · 부리, 재질별 프리미티브) + 아마추어 `penguin_rig` + **날개 관절 필렛** `penguin.joint.L` · `penguin.joint.R`(아래).
- **뼈 이름**: `root` · `body` · `head` · `wing.L` · `wing.R` · `leg.L` · `leg.R` · `foot.L` · `foot.R`(웹이 찾는 것은 `root` · `body` · `head` · `wing.*` · `foot.*`). 소품 붙는 자리(변형 없는 뼈): `socket.head` · `socket.chest` · `socket.hand.R`.
- **좌표**: 쉼 자세(바인드) = **서 있는** 펭귄, 원점 = 두 발 사이 바닥(선 키 0.735 m, 몸 바닥 0.03 m). 앉은 상태 클립은 `root` 를 내려 **몸 바닥을 원점 = 의자 좌석(§3)에** 둔다(5 mm 띄움 — 좌석과 겹치지 않게). 선 클립(`stand` …)은 발이 원점.
- **날개 = 경첩**(DESIGN.md `## 에이전트 캐릭터` — 날개 관절): 단단한 가죽 노가 어깨 경첩에서 몸의 앞뒤 축으로만 든다. **들기 −8° … 112°**(쉼 = 0, 날개가 31° 벌어져 매달린 자세), **비틀기 ±15°**(날개 길이 축). 앞으로 휘두르는 축은 없다 — 날개가 몸 앞에 와야 하면 **몸 전체를 돌린다**. 웹 상수 `WING_LIMITS`(web/src/office/contract.ts), 빌드 `penguin_v3.WING_RAISE_MAX` 등 — 같은 값. 각도 정의(리그 좌표, glTF 축 x = 펭귄 왼쪽, y = 위, z = 앞): 날개 뼈의 쉼 대비 회전 `L`(부모 `body` 의 쉼 축으로 표현)에서 `e1 = L·e0`, 들기 = `atan2(s·e1.x, −e1.y) − atan2(s·e0.x, −e0.y)`(s = L +1 · R −1), 비틀기 = 들기를 뺀 나머지 회전의 `e0` 축 성분 × s. 겨누는 코드(랜딩)는 매 프레임 `office/joint.ts` `clamp` 로 경첩 위로 되돌린다.
- **필렛** `penguin.joint.L/R` — 몸과 날개 사이 반지름 12 mm 매끈한 이음 곡면. `body` 뼈에 100% 스킨, **모프 타깃 51개** `welt.<들기>.<비틀기>`(들기 −8 … 120, 8° 간격 × 비틀기 −15 · 0 · +15, 이름 예 `welt.+096.-15`). 노드 extras: `joint_side` · `joint_raise`(격자) · `joint_twist`(격자) · `joint_e0`(날개 쉼 축, 리그 좌표). **웹은 매 프레임 날개 뼈의 (들기, 비틀기)로 이웃 네 격자점을 이중선형 가중**한다(`office/joint.ts` `update` — 사무실은 믹서 다음, 랜딩은 날개를 겨눈 다음). 재질 = `penguin.body#joint` 하나(웹은 팔레트 키 `penguin.body` 로 칠한다). **흰색은 픽셀마다** r12 규칙 그대로 정한다 — 날개 쪽 줄(정점 속성 `_joint_white` > 0) **이고** 자세를 잡은 날개 자기 좌표에서 날개 흰 면 안(`−w − rim > 0`, 날개 자체의 흰 가장자리와 같은 필드). 셰이더가 날개 뼈의 스킨 행렬로 계산한다(`_joint_side` = ±1, extras `joint_pivot` · `joint_ew` · `joint_rim`, `office/joint.ts` `installJointWhite`). 법선은 모든 셰이프 키에서 정확한 곡면 법선(빌드가 GLB 에 덮어쓴다, `web/scripts/patch-penguin-joints.mjs`), 가장자리 줄은 웹 몸 · 웹 날개 메시 위에 붙인다 — 필렛 둘레에 고리 · 턱 · 톱니가 생기지 않는다(2026-11-25).
- 생김새 = DESIGN.md `## 에이전트 캐릭터`(v3). 2D 아이콘의 정면 값은 같은 모델에서 뽑는다(`scripts/penguin_2d.py` → `web/src/characters/penguinShape.ts`).
- **역할 소품** = 별도 메시, 이름 `prop.<에이전트 id>.<부분>`, 사용자 정의 속성 `socket` = `head` | `chest` | `hand.R`. 15명 전부 + 팀 색 스카프 `prop.scarf`(소품 없는 역할용) — v3 몸에 맞춰 다시 놓았다(`penguin_prod.build_props`):

| 에이전트 | 소품 |
|---|---|
| chief | `prop.chief.crown` · `prop.chief.bowtie` |
| product-manager | `prop.product-manager.clipboard` |
| product-designer | `prop.product-designer.beret` |
| researcher | `prop.researcher.glasses` |
| data-analyst | `prop.data-analyst.chart` |
| frontend-engineer | `prop.frontend-engineer.beanie` |
| backend-engineer | `prop.backend-engineer.headset` |
| data-engineer | `prop.data-engineer.cube` |
| infra | `prop.infra.hardhat` · `prop.infra.shield` |
| quality-assurance | `prop.quality-assurance.magnifier` |
| business-strategy | `prop.business-strategy.tie` |
| sales | `prop.sales.card` |
| finance | `prop.finance.glasses` · `prop.finance.calculator` |
| marketer | `prop.marketer.megaphone` |
| creative | `prop.creative.brush` |

## 6. 동작 클립 — glTF 애니메이션 이름

**상태 클립**(이름 = 상태 id, 의자에 앉은 자세, 다리는 앞으로 — 발바닥이 배 앞 좌석에): `idle` · `idle_doze`(저녁의 쉬는 중) · `thinking` · `typing` · `waiting` · `done` · `error`.
**선 클립**(2026-11-25, 발이 원점): `stand`(랜딩의 기본 — 선 채 숨쉬기) · `walk`(제자리 뒤뚱 걸음 1주기) · `hop`(제자리 뛰기) · `wave`(왼날개 흔들기 — 몸 14° 돌림 + 비틀기 −12°).

| 클립 | 프레임(30 fps) | 들기 범위 | 비틀기 |
|---|---|---|---|
| `idle` · `idle_doze` · `thinking` · `typing` · `waiting` · `error` | 60 | ≤ 104° | ≤ ±10° |
| `done` | 30 | 5 … 50° | 0 |
| `stand` | 60 | 2 … 6° | 0 |
| `walk` | 32 | 3 … 17° | 0 |
| `hop` | 36 | 6 … 42° | 0 |
| `wave` | 48 | 0 … 108° | −12° |

- 30 fps, 길이 1~2초, **이음매 없는 반복**(첫 프레임 = 마지막 프레임). `done` 도 반복 클립(웹이 10초 뒤 `idle` 로 바꾼다).
- 모든 채널은 정수 주기 사인의 합이고, 움직이는 점(날개 끝 · 머리)은 1/4 주기 어긋난 두 채널로 **타원을 그린다** — 같은 선을 되짚는 왕복이 없다(motion_path 튐 · 꺾임 0).
- **게이트**(`scripts/penguin_prod_qa.py`, skills/rig-motion-clearance): 모든 클립에서 날개 끝 ↔ 몸 · 머리 · 얼굴 · 발 · 다른 날개 · 필렛 · 책상 세트(앉은 클립) · 랜딩 카드 면(선 클립) 간격 ≥ 8 mm, 몸 · 발 · 머리가 의자 · 책상을 뚫지 않음, motion_path 튐 · 꺾임 0, 관절 한계 안. 결과 `assets/office/qa/penguin-gate.md`.
- 소품은 소켓 뼈를 따라 같이 움직인다. 필렛 모프 가중치는 클립에 굽지 않는다(웹이 뼈 각도에서 계산).

## 7. 조명 · 그림자

- 고정 모듈은 **AO 를 두 번째 UV(`uv_ao`)에 구워** 모듈마다 텍스처 하나(`<모듈>_ao`, 1024px 이하)로 낸다. 타일을 붙여도 이어지도록 모듈 단위로 굽는다.
- 저녁 톤은 웹이 조명 · 재질 색 · 발광으로 만든다(별도 구운 맵 없이 시작, 부족하면 이 문서를 고쳐 저녁 맵을 추가).
- 실시간 그림자는 웹이 펭귄 접지 그림자만 그린다.

## 8. 예산 · 압축

| 항목 | 한도 |
|---|---|
| `office-kit.glb` + `penguin.glb` 합계 | 5 MB 이하(압축 후) |
| 텍스처 | 1024px 이하, WebP(`EXT_texture_webp`) — 펭귄 2장(`penguin_detail` · `penguin_relief`) |
| 삼각형 | 펭귄 8k(필렛 포함, 소품 제외 — v3 7,384) · 역할 소품 각 800 · 책상 세트 3k · 소품 각 2k · 방 조각 각 500 |
| 메시 압축 | meshopt(`EXT_meshopt_compression`) |

## 9. 넘겨주는 방식

- Blender 세션은 저장소 작업 트리의 별도 브랜치(`feat/office-assets`)에 커밋 · 푸시한다. 웹 연결과 main 머지는 웹 세션이 맡는다.
- 단계마다 스타일 프레임 · 확정 팔레트 실측값을 `assets/office/README.md` 에 적고, DESIGN.md 팔레트 표는 웹 세션이 같이 고친다.
