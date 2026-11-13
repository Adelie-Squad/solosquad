---
name: rig-motion-clearance
description: 리그·스키닝·모션을 관통 없이 설계하고 검증한다 — 관절 한계표, 경첩 방식 선택(꿰맨 별도 파츠 vs 스키닝, bone heat 웨이트, 교정 셰이프 키), 팔다리 과회전 대신 몸 전체 회전, 매 프레임 모든 다른 요소(몸·머리·얼굴 파츠·소품·UI 평면)와의 간격 검사, 간격이 임계값 미만이면 렌더 실패. 애니메이션 12원칙(arc·follow-through·ease)과 Blender Limit Rotation·BVHTree 기반. 사용 시점 — 캐릭터를 움직이거나 포즈를 잡을 때(광의), 날개·팔이 머리나 몸을 뚫을 때, 웨이트가 찢어지거나 접힐 때, 손 흔들기·점프 같은 모션 클립을 만들 때, 웹용 애니메이션 클립을 설계할 때(구체). (제외 — 정적 모양 수정은 3d-previz-edit, 레퍼런스 분석은 reference-video-analysis)
schema_version: 2
tier: member
team: _skill
category: design
used_by: ["creative", "frontend-engineer"]
dev_capability: false
triggers:
  keyword: ["리깅", "rigging", "스키닝", "skinning", "웨이트", "skin weight", "모션", "motion", "관절", "joint limit", "관통", "penetration", "clipping", "포즈", "pose"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 2
---

# Rigging & Motion Without Penetration

> 관통은 "애니메이션을 다 만든 뒤 눈으로 찾는" 문제가 아니라 **설계 단계의 한계값 + 매 프레임 측정**
> 으로 막는 문제다. 렌더 전에 `scripts/clearance_check.py` 가 0 으로 끝나지 않으면 렌더하지 않는다.

## 언제 쓰나
- 캐릭터에 뼈를 넣거나(리깅·스키닝), 포즈·모션 클립(손 흔들기·점프·인사·idle)을 만들 때.
- 움직이는 부위가 다른 부위·소품·UI 평면과 겹치거나, 관절에서 메시가 찢어지고 접힐 때.

## 입력
- 리그된 `.blend`(또는 리깅할 메시), 모션 스펙(`reference-video-analysis` 산출물 또는 사용자 설명).
- 부딪히면 안 되는 쌍 목록(아래 §1), 최소 간격 임계값(기본: 캐릭터 높이의 1%).

## 절차

### 1. 관절 한계표 + 금지 쌍 (애니메이션 전에)
| 관절 | 축 | 최소° | 최대° | 근거 |
|---|---|---|---|---|
| wing.L (어깨) | X(올리기) | -10 | 120 | 120° 넘으면 날개 끝이 머리 높이 — 클리어런스 검사로 확인한 값 |
| wing.L | Z(앞뒤) | -30 | 45 | |
| head | Z(돌리기) | -60 | 60 | 그 이상은 몸 전체 회전(§3) |

- 한계는 Blender **Limit Rotation 제약**(Local Space, Affect Transform 켬)으로 리그에 박는다 — 문서가 아니라 리그가 한계를 지킨다.
- **금지 쌍 표**: 움직이는 부위 × (몸·머리·눈·부리·소품·UI 평면 등 다른 모든 요소). 붙어 있어야 하는 이음매(날개 뿌리↔몸)는 쌍이 아니다 — 날개 *끝/가장자리* 그룹 vs 머리처럼 떨어져 있어야 하는 영역을 쌍으로 둔다.

### 2. 경첩 방식 고르기 (≥2 비교 후 선택)
| 방식 | 언제 | 대가 |
|---|---|---|
| **꿰맨 별도 파츠**(날개를 별도 오브젝트로, 뼈에 parent, 뿌리를 몸 안으로 묻음) | 단단한 부속(날개·부리·안경), 마스코트·로우폴리 | 이음매가 보일 수 있음 → 뿌리를 몸 속으로 충분히 묻고 shading 으로 숨김 |
| **스키닝**(armature deform, bone heat 자동 웨이트) | 몸과 연속된 살(목·배·꼬리) | 큰 회전에서 부피 손실·접힘 → Preserve Volume(dual quaternion) 또는 교정 셰이프 키 |
| **교정 셰이프 키**(driver 로 관절 각도에 연결) | 스키닝 후 특정 각도에서만 찌그러질 때 | 각도별 키 제작 비용 |

- 자동 웨이트(With Automatic Weights)가 실패하면 대개 메시가 겹치거나 비다양체 — SDF 메시는 리메시 후 다시.
- 웨이트 점검: 각 정점 웨이트 합 = 1, 영향 뼈 ≤ 4(웹 GLB 한도), 날개 그룹이 머리 정점에 0 인지.

### 3. 포즈·모션 설계 원칙
- **과회전 대신 몸 전체**: 한 관절이 한계 근처까지 가야 하면 상위(허리·몸 전체)를 먼저 돌린다.
  손 흔들기에서 어깨만 150° 올리지 말고 몸을 5–10° 기울여 날개 끝 경로를 머리에서 떼어 낸다.
- **arc**: 끝점(날개 끝·머리 끝)의 경로는 호를 그린다. 직선·꺾임은 기계적으로 보인다.
- **follow-through / overlapping**: 자식 뼈는 부모보다 1–3 프레임 늦게 멈춘다(위상 지연).
- **ease in/out + hold**: 키 포즈 앞뒤로 간격이 줄고, 중요한 포즈는 6–12 프레임(24fps) 유지.
- **keyed vs procedural**: 반복·무한(idle 호흡·꼬리 흔들기)은 절차적(sin·노이즈 driver 또는 런타임 코드), 연기는 키프레임. 웹이면 클립은 액션 단위로 나눠 three.js `AnimationMixer` 에서 교차 페이드.

### 4. 매 프레임 측정 (렌더 게이트)
```bash
# 간격: 관통·임계 미만이면 exit 1
blender -b rig.blend --python scripts/clearance_check.py -- \
  --moving "Penguin:wing_tip_L,Penguin:wing_tip_R" \
  --against "Penguin:head,Penguin:beak,EyeL,EyeR,Sign" \
  --frames 1-48 --min-clearance 0.012 --out clearance.csv
# 궤적: 튐(pop)·꺾임(kink)·hold 목록
blender -b rig.blend --python scripts/motion_path.py -- \
  --track "Armature:wing.L,Armature:head" --frames 1-48 --out motion.csv
```
- 파트는 `Object` 또는 `Object:VertexGroup` — 한 메시 안의 날개/머리 영역도 분리해 잰다. 위치는
  평가된 depsgraph(스키닝·셰이프 키·제약 반영) 기준.
- 실패 프레임이 나오면: ① 그 프레임 포즈를 previz 로 확인 ② 원인이 한계값이면 §1 표 수정 → 리그에 반영
  ③ 원인이 포즈면 몸 전체 회전·arc 조정 ④ 다시 전체 범위 측정. **실패한 채로 렌더 금지.**
- motion_path 의 hold 목록·간격을 레퍼런스의 timing chart 와 나란히 비교한다.

### 5. 보고
- 관절 한계표, 금지 쌍별 최소 간격(프레임 번호와 함께), pop/kink 0 여부, 채택한 경첩 방식과 탈락안 이유.
- 키 포즈 3–5장 + 최소 간격 프레임 1장(같은 QA 카메라) — `3d-previz-edit` 의 카메라 재사용.

## 체크 (HARD GATE)
```markdown
- [ ] 관절 한계가 표로 있고 Limit Rotation 제약으로 리그에 적용됐다
- [ ] 금지 쌍 표가 움직이는 부위 × 다른 모든 요소(소품·UI 평면 포함)를 덮는다
- [ ] 경첩 방식 ≥2 비교 후 선택, 이유 기록
- [ ] clearance_check 전체 프레임 exit 0 (최소 간격 수치 보고)
- [ ] motion_path pop·kink 0, hold 위치가 모션 스펙과 일치
- [ ] 웨이트: 정점당 영향 뼈 ≤ 4, 금지 영역 웨이트 0
```

## 산출물
관절 한계표 · 금지 쌍 표 · `clearance.csv` · `motion.csv` · 키 포즈 previz · 모션 스펙 대비 차이 메모.

## 함정 (Gotchas)
- **서브샘플링 누락**: 빠른 동작은 프레임 사이에서 관통한다 — 빠른 구간은 `--frames 10-16 --subframes 4` 로 프레임 사이까지 측정한다(모션 블러 렌더면 필수).
- 정적 포즈 하나만 보고 "안 뚫는다" 결론 금지 — 극점(extreme) 포즈와 그 사이 breakdown 이 문제다.
- 닫히지 않은 메시는 "안쪽" 판정이 틀릴 수 있다 — 그때는 `crossing` 열(표면 교차)을 신뢰.
- 대칭 복사(.L→.R) 후 한쪽만 고치면 반대쪽이 회귀 — 수정은 양쪽 동시에, 측정도 양쪽.
- IK 를 쓰면 한계 제약이 체인 전체에 걸리는지 확인(IK 는 개별 FK 한계를 무시할 수 있음 — IK 제약의 Limits 설정).
- UI 평면·말풍선·간판 같은 "그림이 아닌 것"도 요소다 — 금지 쌍에서 빠뜨리기 쉽다.

## 출처
- Limit Rotation 제약: https://docs.blender.org/manual/en/latest/animation/constraints/transform/limit_rotation.html
- Armature 자동 웨이트(bone heat): https://docs.blender.org/manual/en/latest/animation/armatures/skinning/parenting.html
- Shape keys(교정 셰이프): https://docs.blender.org/manual/en/latest/animation/shape_keys/introduction.html
- `mathutils.bvhtree` (`overlap`·`find_nearest`): https://docs.blender.org/api/current/mathutils.bvhtree.html
- Thomas & Johnston, *The Illusion of Life* (1981) — 12원칙. Richard Williams, *The Animator's Survival Kit* — arc·spacing·follow-through.
- OpenDCAI/GameFactory-3A `asset_qa/motion` (Apache-2.0) — 모션 QA 항목(관통·웨이트·IK 잔차) 구성을 각색.
- three.js AnimationMixer: https://threejs.org/docs/ · CloudAI-X/threejs-skills (MIT) — 웹 클립 관점 참고.
