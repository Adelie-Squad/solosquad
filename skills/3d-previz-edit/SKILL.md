---
name: 3d-previz-edit
description: 3D 모델·캐릭터 수정을 요구사항→측정 가능한 수용 기준 표로 바꾸고, 기준선 고정 → 같은 카메라 저해상도 프리비즈 → 한 번에 한 부위만 수정 → 이전 라운드와 동일 카메라 회귀 비교 → 수치 기준표 보고 순서로 진행한다. Blender 헤드리스 스크립팅(bpy·MCP)과 업계 표준 blockout→previz→targeted edit→regression 기반. 사용 시점 — 3D 마스코트·캐릭터·제품 모델을 만들거나 고칠 때(광의), "부리 키워줘", "날개 모양 바꿔줘", "다시 렌더해줘", 수정했더니 다른 데가 망가졌을 때, GLB 로 웹에 내보낼 때(구체). (제외 — 관절·스키닝·모션 관통은 rig-motion-clearance, 레퍼런스 영상 분석은 reference-video-analysis, 영상 조립은 previz-assembly)
schema_version: 2
tier: member
team: _skill
category: design
used_by: ["creative", "frontend-engineer"]
dev_capability: false
triggers:
  keyword: ["3d", "3D 모델", "3D 수정", "블렌더", "blender", "previz", "프리비즈", "모델링", "렌더링", "turntable", "턴테이블", "glb", "gltf"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 1
---

# 3D Previz & Targeted Edit

> 3D 수정이 "하나 고치면 다른 게 깨지는" 이유는 셋이다 — 요구사항이 숫자가 아니고, 비교 기준
> (같은 카메라의 이전 렌더)이 없고, 여러 부위를 한꺼번에 바꾼다. 이 skill 은 그 셋을 절차로 막는다.
> **눈대중 수정 금지("좀 더 귀엽게 해봤어요")** — 모든 라운드는 기준표의 숫자로 끝난다.

## 언제 쓰나
- 3D 모델(마스코트·캐릭터·제품·씬)을 새로 만들거나 고칠 때 — 모양·비율·색·재질·포즈.
- 사용자가 렌더를 보고 "여기 이상해"라고 했을 때, 또는 직전 수정이 다른 부위를 망가뜨렸을 때.
- 웹(three.js·R3F)용 GLB/glTF 로 내보낼 때(아래 §6).

## 입력
- 대상 파일(`.blend`·`.glb`)과 대상 오브젝트 이름, 이전 라운드 렌더 폴더(있으면).
- 사용자 요구사항 원문(그대로 인용 — 해석은 §1 표에서).
- 레퍼런스 이미지·영상(있으면 — 영상은 `reference-video-analysis` 먼저).

## 절차

### 1. 요구사항 → 수용 기준 표 (코드 쓰기 전에)
요구사항 한 줄마다 **측정 방법 + 목표값 + 측정 카메라**를 정한다. 측정할 수 없으면 사용자에게
되묻는다(≤2개 질문). 예:

| # | 요구사항(원문) | 측정 | 목표 | 카메라 |
|---|---|---|---|---|
| R1 | "부리가 너무 작아" | 부리 bbox 폭 ÷ 머리 bbox 폭 | 0.30 → 0.38±0.02 | QA_front |
| R2 | "눈이 몰려 보여" | 두 눈 중심 거리 ÷ 머리 폭 | ≥ 0.42 | QA_front |
| R3 | "날개가 머리를 뚫어" | 전 프레임 날개↔머리 최소 간격 | ≥ 0.01 m | 클립 전체 |
| R4 | "나머지는 그대로" | 수정 영역 밖 변경 픽셀 비율 | ≤ 0.2% | 5개 QA 뷰 |

- 수치는 `bpy` 로 측정한다(bound_box·vertex 좌표·`mathutils` 거리). 이미지 픽셀로 재지 않는다.
- **R4 같은 "회귀 금지" 행은 항상 넣는다** — 사용자가 말하지 않은 부위가 보호 대상이다.
- 주관 기준("더 귀엽게")은 ≥2 방향을 previz 로 보여 주고 고르게 한 뒤, 고른 안의 수치를 목표로 고정.

### 2. 기준선 고정 (round 0)
1. 작업 전 `.blend` 를 `rounds/r00.blend` 로 복사(되돌릴 지점).
2. `scripts/qa_render.py` 로 고정 QA 카메라 5개(front·side·back·3q·top)를 만들고 r00 을 렌더.
   카메라는 `.blend` 안 `QA_cameras` 컬렉션에 저장 — **이후 라운드는 절대 카메라를 옮기지 않는다**
   (옮기면 비교가 무의미. 바꿔야 하면 사용자 합의 후 `--reframe` 하고 새 기준선부터 다시).
3. §1 표의 현재값(before)을 측정해 기록.

```bash
blender -b model.blend --python scripts/qa_render.py -- --target Penguin --out renders/r00 --quality previz
```

### 3. 프리비즈 먼저, 풀 렌더는 마지막
- previz = Workbench·50% 해상도·같은 카메라(초 단위). 모양·비율·포즈 결정은 previz 로 끝낸다.
- 풀 렌더(`--quality final`)는 기준표가 전부 통과한 뒤 1회. 재질·조명 수정만 final 로 반복.
- 모션이 있으면 키 프레임 몇 장(`--frames 1,12,24`)만 previz, 전체 클립은 마지막.

### 4. 한 라운드 = 한 부위
1. 이번 라운드에서 바꿀 **부위 1개**와 그 부위의 화면 영역(QA 카메라별 박스)을 적는다.
2. 그 부위만 수정한다. SDF·모디파이어·노드 파라미터면 **바꾼 파라미터와 값(before→after)을 기록**.
   여러 부위를 묶어 바꾸고 싶으면 라운드를 쪼갠다.
3. 같은 카메라로 previz 렌더 → `scripts/render_compare.py` 로 직전 라운드와 비교:

```bash
blender -b --factory-startup --python scripts/render_compare.py -- \
  --before renders/r02/QA_front_f0001.png --after renders/r03/QA_front_f0001.png \
  --region beak=0.40,0.35,0.60,0.55 --edit beak --tol 0.03 --max-outside 0.002
```

   - `outside` 변경 비율이 한도를 넘으면(exit 1) **누수** — 다음 부위로 가지 말고 원인부터 고친다.
   - 의도한 전역 변경(조명·전체 스케일)은 라운드를 따로 두고 `--max-outside` 를 명시적으로 풀었다고 적는다.
4. §1 표의 측정값을 다시 잰다. 통과 행이 이전보다 줄었으면 이번 수정을 되돌린다(`rounds/` 복사본).
5. 통과하면 `rounds/rNN.blend` 로 저장하고 다음 부위.

### 5. 보고 — 기준표 + 비교 이미지
매 라운드 사용자에게:
- 기준표(요구사항 · before · after · 목표 · 통과 여부) — 숫자로.
- 직전 라운드 대비 비교 스트립(같은 카메라, 좌 before / 우 after, 라벨) — `previz-assembly` §2.
- 바꾼 파라미터 목록과 아직 미통과 행. "좋아졌어요" 같은 형용사 보고 금지.

### 6. 웹 내보내기(GLB) — 해당 시
- Blender glTF exporter: 모디파이어 적용, +Y up, 미사용 데이터 제거, 애니메이션은 NLA 트랙/액션 단위로 이름.
- `gltf-transform`(MIT)으로 정리·압축: `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress ktx2`
  (모핑·스키닝 메시는 meshopt 가 Draco 보다 안전), LOD 는 `simplify` 단계별 파일로.
- Khronos `glTF-Validator` 로 오류 0 확인 → three.js/R3F 에서 같은 카메라 각도로 스크린샷 1장 비교.

## 체크 (HARD GATE — 라운드 종료 조건)
```markdown
- [ ] 모든 요구사항이 측정·목표·카메라가 있는 기준표 행이다(+ 회귀 금지 행)
- [ ] 기준선(r00) 렌더와 .blend 사본이 있고 QA 카메라는 이후 이동 0
- [ ] 이번 라운드에서 바뀐 부위는 1개, 바꾼 파라미터가 기록됐다
- [ ] render_compare 의 outside 변경 ≤ 한도 (모든 QA 뷰)
- [ ] 기준표 통과 행 수가 이전 라운드보다 줄지 않았다
- [ ] 보고에 숫자 표 + 같은 카메라 비교 이미지가 있다
```

## 산출물
`rounds/rNN.blend` · `renders/rNN/QA_*.png` · 라운드별 `compare.md`(render_compare 출력) · 기준표.

## 함정 (Gotchas)
- **카메라를 "더 잘 보이게" 옮기기** → 이전 라운드와 비교 불가. QA 카메라 고정, 감상용 카메라는 따로.
- **SDF/메타볼 블렌드 반경**은 인접 부위까지 바꾼다(부리 키우면 볼이 부풂) — 수정 영역 박스를 넉넉히 잡지 말고 누수를 측정해서 확인.
- 스키닝된 메시는 **레스트 포즈와 애니메이션 포즈 둘 다** 측정 — 모양 수정이 웨이트를 깨뜨릴 수 있다(`rig-motion-clearance`).
- `scene.render.engine` 이름·enum 은 버전마다 다르다 — 하드코딩 말고 읽어서 쓴다. 셰이더 노드는 이름이 아니라 `type` 으로 찾는다.
- Workbench previz 는 재질 차이를 거의 못 보여 준다 — 색·재질 요구사항은 final 렌더에서 측정.
- 헤드리스(`-b`)에서 `sys.exit(1)` 은 프로세스 종료 코드로 전달된다 — 렌더 파이프라인에서 게이트로 쓴다.

## 출처
- Blender 커맨드라인 렌더(`-b`, `--python`): https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html
- Blender 렌더 회귀 테스트 패턴(기준 이미지 + idiff 임계값 + 명시적 재기준화): https://developer.blender.org/docs/handbook/testing/ — 아이디어를 각색, 코드는 자체 작성.
- MCP for Blender (ahujasid/blender-mcp, MIT) — 실행 런타임으로만 사용, 절차는 이 skill.
- ProfRino/Blender-MCP-Assembly-Skill — "코드 전에 요구사항을 검사 항목으로" 아이디어만 참고(라이선스 없음, 문구 미복제).
- glTF-Transform (MIT): https://gltf-transform.dev/ · Khronos glTF-Validator (Apache-2.0): https://github.com/KhronosGroup/glTF-Validator
- 조사 노트: `docs/research/creative-3d-motion-video-skills_261113.md`
