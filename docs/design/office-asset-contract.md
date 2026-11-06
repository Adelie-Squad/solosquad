# 사무실 3D 에셋 규격 (Blender → GLB → 웹)

> DESIGN.md `## 사무실 장면` v3(점토 스타일)의 **제작 절차**를 구체화한 규격이다. Blender 쪽(MCP for Blender 작업 세션)이 만든 결과물이
> 웹(React Three Fiber)에 손대지 않고 들어가도록, 이름 · 단위 · 구성 · 예산을 여기서 고정한다. 규격을 바꾸려면 이 문서를 먼저 고친다.
> 작성 2026-11-07.

## 1. 저장 위치

```
assets/office/
  scripts/build_kit.py        Blender Python — 방 조각 · 책상 세트 · 소품 · 조명을 빈 장면에서 만들어 .blend 로 저장
  scripts/build_penguin.py    Blender Python — 펭귄 몸 · 리그 · 동작 · 역할 소품을 만들어 .blend 로 저장
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
- 펭귄 크기: 의자에 앉은 키 **0.60 m**(폭 0.53 · 깊이 0.33), 책상 상판 높이 0.72 m 에 날개가 닿는 비례. 0.55 m 이면 위 30° 시점에서 얼굴이 노트북 뚜껑에 가려져 올렸다(스타일 프레임 실측, 2026-11-07).
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
| `penguin.body` · `penguin.face` · `penguin.cheek` · `penguin.eye` · `penguin.beak` · `penguin.feet` | 펭귄 |
| `prop.<색 이름>` | 소품의 고정 색(예: `prop.gold` · `prop.black`) |

- 모든 재질 = 무광(roughness 0.8 이상) · metallic 0 · 텍스처 무늬 없음.

## 5. 펭귄 (penguin.glb)

- 메시 `penguin` 하나 + 아마추어 `penguin_rig`. 뼈 이름: `root` · `body` · `head` · `wing.L` · `wing.R` · `foot.L` · `foot.R`.
- 소품 붙는 자리(뼈) : `socket.head` · `socket.chest` · `socket.hand.R`.
- 생김새 = SoloSquad 펭귄 2D 아이콘과 같은 캐릭터: 봉제 키링처럼 납작하고 통통한 실루엣 · 하트 모양 흰 얼굴 · 마젠타 볼 · 가장자리 스티치(얕은 홈). 잉크 윤곽선 없음.
- **역할 소품** = 별도 메시, 이름 `prop.<에이전트 id>.<부분>`, 사용자 정의 속성 `socket` = `head` | `chest` | `hand.R`. 15명 전부 + 팀 색 스카프 `prop.scarf`(소품 없는 역할용):

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

## 6. 동작 클립 — glTF 애니메이션 이름 = 상태 id

`idle` · `idle_doze`(저녁의 쉬는 중) · `thinking` · `typing` · `waiting` · `done` · `error`

- 30 fps, 길이 1~2초, **이음매 없는 반복**(첫 프레임 = 마지막 프레임). `done` 도 반복 클립(웹이 10초 뒤 `idle` 로 바꾼다).
- 의자에 앉은 자세 기준. 자리를 옮기는 이동은 없다(제자리 동작만).
- 소품은 소켓 뼈를 따라 같이 움직인다.

## 7. 조명 · 그림자

- 고정 모듈은 **AO 를 두 번째 UV(`uv_ao`)에 구워** 모듈마다 텍스처 하나(`<모듈>_ao`, 1024px 이하)로 낸다. 타일을 붙여도 이어지도록 모듈 단위로 굽는다.
- 저녁 톤은 웹이 조명 · 재질 색 · 발광으로 만든다(별도 구운 맵 없이 시작, 부족하면 이 문서를 고쳐 저녁 맵을 추가).
- 실시간 그림자는 웹이 펭귄 접지 그림자만 그린다.

## 8. 예산 · 압축

| 항목 | 한도 |
|---|---|
| `office-kit.glb` + `penguin.glb` 합계 | 5 MB 이하(압축 후) |
| 텍스처 | 1024px 이하, WebP(`EXT_texture_webp`) |
| 삼각형 | 펭귄 8k · 역할 소품 각 800 · 책상 세트 3k · 소품 각 2k · 방 조각 각 500 |
| 메시 압축 | meshopt(`EXT_meshopt_compression`) |

## 9. 넘겨주는 방식

- Blender 세션은 저장소 작업 트리의 별도 브랜치(`feat/office-assets`)에 커밋 · 푸시한다. 웹 연결과 main 머지는 웹 세션이 맡는다.
- 단계마다 스타일 프레임 · 확정 팔레트 실측값을 `assets/office/README.md` 에 적고, DESIGN.md 팔레트 표는 웹 세션이 같이 고친다.
