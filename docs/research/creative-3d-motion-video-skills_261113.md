# 크리에이티브 3D · 모션 · 영상 skill 조사 (2026-11-13)

> 계기: 3D 펭귄 마스코트를 Blender 헤드리스 스크립트(SDF 모델링 · 스키닝 · 렌더)로 고치던 에이전트가
> 계속 회귀했다 — 한 부위를 고치면 다른 부위가 깨지고, 요구사항이 측정 가능한 기준이 되지 않았고,
> 날개 모션이 머리를 관통했다. 사용자 요청: 3D · 모션 · 영상 skill 을 조사해 SoloSquad 에 넣고
> `creative` 에이전트가 쓰게 할 것. GitHub 에서 뜨는 것과 업계 정석 위주로.
>
> 결과물: `skills/3d-previz-edit` · `skills/rig-motion-clearance` · `skills/reference-video-analysis` ·
> `skills/previz-assembly` (+ creative · frontend-engineer `skills_used`, brand `shared_skills`).

수치(스타 · 마지막 push · 라이선스)는 2026-11-13 에 `gh api repos/…` 로 확인한 값이다. "미확인" 표시가
없는 것만 확인값. 외부 코드는 읽기만 했고 설치 · 실행하지 않았다.

## 1. 결론 먼저

1. **3D 리깅 · 스키닝 · 회귀를 다루는 쓸 만한 SKILL.md 는 없다.** 있는 것은 Blender 를 실행하는 MCP
   서버(런타임)와 좁은 skill 몇 개다. 규율(기준표 · 고정 카메라 · 한 부위씩 · 매 프레임 간격 검사)은
   우리가 써야 한다 → 4개 skill 자체 작성, 아이디어는 출처 표기 후 각색.
2. **"rea 비디오" = `JuneYaooo/rea-video`** (확신 높음, 아래 §4). Apache-2.0 Claude Code skill · 플러그인.
   레퍼런스 영상을 샷 단위로 역설계한다. 우리는 설치하지 않고 방법(샷 분해 · contact sheet · 소재 분류 ·
   리메이크 레시피)만 각색해 ffmpeg 기반 `reference-video-analysis` 에 넣었다.
3. 영상 제작은 **Remotion 공식 Agent Skills(`remotion-dev/skills`)** 가 가장 성숙하지만 Remotion 은
   OSI 오픈소스가 아니다(직원 3명 초과 영리 회사는 유료). MIT 대안은 Motion Canvas · Revideo.
4. 웹 3D 파이프라인 정석: Blender glTF exporter → **glTF-Transform**(meshopt · KTX2) → **Khronos
   glTF-Validator** → three.js `AnimationMixer` / R3F `useAnimations`.

## 2. 3D — Blender + 에이전트

| 이름 | 무엇 | 스타 / push / 라이선스 | 판단 |
|---|---|---|---|
| [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) | 라이브 Blender 에 bpy 코드 실행 · 씬 조회 · 뷰포트 캡처하는 MCP | 34,279 / 2026-11-13 / MIT | **참고(런타임)** — 실행 수단일 뿐 작업 규율이 없다. 규율은 우리 skill 로 |
| Blender Lab 공식 MCP (projects.blender.org/lab/blender_mcp) | Blender 재단 MCP, Claude Blender 커넥터의 기반으로 알려짐 | GitHub 아님, 버전 · 날짜 미확인 | 참고 |
| [ProfRino/Blender-MCP-Assembly-Skill](https://github.com/ProfRino/Blender-MCP-Assembly-Skill) | 코드 전에 관절 지도 작성 · 겹침/틈 검사 | 85 / 2026-05-25 / **라이선스 없음** | **아이디어만** — "요구사항을 검사 항목으로 먼저" (문구 미복제, 출처 표기) |
| [OpenDCAI/GameFactory-3A](https://github.com/OpenDCAI/GameFactory-3A) `asset_qa/motion` | 스켈레톤 피팅 · IK 모션 · QA 목록(뼈 길이, 바닥 관통, IK 잔차, 웨이트) | 1,038 / 2026-11-11 / Apache-2.0 | **각색** — rig-motion-clearance 체크 항목 구성 |
| [CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills) | three.js skill 13개(animation · asset-pipeline · R3F · performance …) | 4,168 / 2026-10-19 / MIT | **참고/각색** — 웹 클립 관점 |
| [carson-katri/geometry-script](https://github.com/carson-katri/geometry-script) | Geometry Nodes 파이썬 API + SKILL.md | 382 / 2026-11-09 / **GPL-3.0** | 참고만 |
| bpy-dev/blender-mcp | 공식 MCP 포크(독립 bpy) | 97 / 2026-09-12 / **GPL-3.0** | 참고만 |
| [anthropics/skills](https://github.com/anthropics/skills) | 공식 skill 모음 | 193,960 / 2026-11-06 | **3D skill 없음**. skill-creator 는 포맷 참고 |
| awesome 목록(VoltAgent · ComposioHQ · travisvn · punkpeye MCP) | 큐레이션 | — | Blender 리깅 · glTF skill 검색 결과 없음 |

**피할 것:** `racdeufindurch198812/Blender-AI-MCP-Studio`, `fumbdendade19718/blender-ai-copilot-desk`,
`credoksopho1984/blender-ai-copilot-studio` — 무작위 계정명, 같은 날 push, 스타 ~100 동일 패턴(스팸/악성 의심).

### 편집 워크플로 · 렌더 회귀 (업계 관행)

blockout → previz → targeted edit → regression 과 턴테이블 렌더는 업계 공통 관행이지만 단일 권위 문서는
없다. 가장 가까운 공개 근거는 **Blender 자체의 렌더 회귀 테스트**다
([testing handbook](https://developer.blender.org/docs/handbook/testing/)): 기준 이미지 + `idiff` 임계값
(실패 임계 0.016, 실패 비율 1%) + `BLENDER_TEST_UPDATE=1` 로 명시적 재기준화 + HTML 리포트. 이 패턴을
"고정 QA 카메라 + 영역별 변경 비율 + 수정 영역 밖 누수 한도"로 각색했다(`render_compare.py`, 자체 작성).

| 도구 | 스타 / push / 라이선스 | 판단 |
|---|---|---|
| OpenImageIO `idiff` | 2,403 / 2026-11-13 / Apache-2.0 | 있으면 사용 가능(도구) |
| mapbox/pixelmatch | 7,022 / 2026-10-06 / ISC | 웹 쪽 스크린샷 비교에 적합 |
| dmtrKovalenko/odiff | 3,297 / 2026-10-13 / MIT | 대안 |
| scikit-image SSIM | 6,638 / 2026-11-11 / BSD-3(미확인) | 대안 |
| kornelski/dssim | 1,211 / 2026-10-01 / **AGPL-3.0** | 피함 |

우리 스크립트는 Blender 내장 numpy 만 써서 추가 설치가 없다.

### 리깅 · 스키닝 · 관통

| 항목 | 출처 | 판단 |
|---|---|---|
| 자동 웨이트(bone heat) | [Blender manual — parenting](https://docs.blender.org/manual/en/latest/animation/armatures/skinning/parenting.html) | 채택 |
| 관절 한계 | [Limit Rotation](https://docs.blender.org/manual/en/latest/animation/constraints/transform/limit_rotation.html) | 채택 — 문서가 아니라 리그에 한계를 박는다 |
| 교정 셰이프 키 | [Shape keys](https://docs.blender.org/manual/en/latest/animation/shape_keys/introduction.html) | 채택 |
| 관통 검사 | [`mathutils.bvhtree`](https://docs.blender.org/api/current/mathutils.bvhtree.html) `overlap` · `find_nearest` | **자체 스크립트** `clearance_check.py` — 날개↔머리 문제를 직접 막는다 |
| Rigify · Auto-Rig Pro · Mixamo | Blender 내장(GPL) / 상용 / Adobe 서비스 | 참고만 — 마스코트엔 과함 |
| RigNet | 1,528 / 2024-11-04 / **GPL-3.0** | 참고만 |
| UniRig | 2,095 / 2026-06-04 / MIT | 참고(나중 실험 후보) |
| Puppeteer · MagicArticulate | 445 · 418 / 2025-09 / Apache-2.0 | 참고만 |

### 모션 · 웹 전달

| 이름 | 스타 / push / 라이선스 | 판단 |
|---|---|---|
| [three.js](https://github.com/mrdoob/three.js) (`AnimationMixer`) | 118,285 / 2026-11-13 / MIT | 참고 문서 |
| react-three-fiber · drei (`useAnimations`) | 33,703 · 10,153 / 2026-10-21 / MIT | 참고 |
| [glTF-Transform](https://gltf-transform.dev/) | 2,075 / 2026-10-20 / MIT | **그대로 채택**(내보내기 파이프라인) |
| meshoptimizer | 8,849 / 2026-10-14 / MIT | 채택(glTF-Transform 경유) |
| Draco | 7,551 / 2026-11-11 / Apache-2.0 | 선택 — 스키닝 · 모프 메시는 meshopt 선호 |
| KTX-Software | 1,401 / 2026-11-10 / 혼합(대부분 Apache-2.0, 미확인) | 도구로 채택 |
| [Khronos glTF-Validator](https://github.com/KhronosGroup/glTF-Validator) | 481 / 2026-10-06 / Apache-2.0 | **게이트로 채택** |
| lottie-web | 32,403 / 2025-09-01(정체) / MIT | 참고만 |
| dotlottie-web | 945 / 2026-11-12 / MIT | 2D 필요 시 이쪽 |
| Rive (rive-wasm) | 1,022 / 2026-11-12 / MIT | 2D 상태 머신 대안 |
| greensock/gsap-skills | MIT(스타 미확인) | skill 구조 참고 |

애니메이션 원칙은 Thomas & Johnston *The Illusion of Life*(1981, 12원칙)와 Richard Williams *The Animator's
Survival Kit*(arc · spacing · follow-through)를 인용하고, 측정 가능한 형태로 바꿨다: 끝점 궤적의 꺾임(kink)
· 간격 튐(pop) · hold 구간 — `motion_path.py`(자체 작성).

### AI 3D 생성 (간단히)

| 이름 | 스타 / 라이선스 | 메모 |
|---|---|---|
| microsoft/TRELLIS · TRELLIS.2 | 14,259 · 12,880 / MIT | 허용적 |
| Tencent-Hunyuan/Hunyuan3D-2 · 2.1 | 15,397 · 4,419 / Tencent community | **라이선스가 EU · 영국 · 한국을 제외**(2.1 LICENSE 확인) — 한국 팀은 사용 불가에 가깝다 |
| VAST-AI-Research/tripo-mcp | 230 / MIT | 유료 API |

마스코트처럼 일관성이 중요한 캐릭터에는 생성보다 스크립트 원본(현재 `assets/office/scripts/`)이 맞다.

## 3. 영상

| 이름 | 무엇 | 스타 / push / 라이선스 | 판단 |
|---|---|---|---|
| FFmpeg filters | `fps` · `select='gt(scene,0.3)'` · `showinfo` · `tile` · `drawtext` · `hstack`/`xstack` · concat | 67,179 / 2026-11-13 / LGPL·GPL | **자체 레시피**(skill 본문) — [문서](https://ffmpeg.org/ffmpeg-filters.html) |
| [PySceneDetect](https://www.scenedetect.com/docs/latest/) | 컷 감지(content · adaptive · threshold) | 5,444 / 2026-11-13 / BSD-3-Clause | 있으면 사용(선택) |
| MediaPipe | 자세 · 손 · 얼굴 랜드마크 → arc 추적 | 37,670 / 2026-11-13 / Apache-2.0 | 선택 |
| HUANGCHIHHUNGLeo/claude-real-video | 중복 제거 프레임 · 격자 · 자막으로 LLM 이 영상을 "보게" | 2,312 / 2026-10-23 / MIT | 참고 — 격자 방식 각색. 유료 Pro 유도 있음 |
| Twelve Labs MCP | 영상 검색 · 요약(호스팅) | 저장소 미확인 | 참고만 — 유료, 영상 업로드 |
| Gemini 영상 이해 | 모델에 영상 직접 입력(기본 1fps 샘플링) | — | 선택적 VLM 백엔드 |
| ffmpeg MCP 서버(dubnium0 · misbahsy) | 23 · 90 스타, 정체 | — | 채택 안 함 — CLI 직접 호출이 단순 |
| Remotion | React 프로그래매틱 영상 | 72,921 / 2026-11-13 / **자체 라이선스** | 조건부 — [라이선스](https://www.remotion.dev/docs/license): 개인 · 직원 ≤3 영리 · 비영리 무료, 그 외 유료 |
| [remotion-dev/skills](https://www.remotion.dev/docs/ai/skills) | 공식 Agent Skills(best-practices · render · captions …) | 6,935 / 2026-11-11 / **라이선스 파일 없음** | 쓸 거면 설치기로 그대로(`npx skills add remotion-dev/skills`), 복제 금지 |
| Motion Canvas | TS 제너레이터 애니메이션 | 19,794 / 2026-07-02 / MIT | MIT 필요 시 대안 |
| Revideo | Motion Canvas 포크, 헤드리스 렌더 | 4,206 / 2026-07-15 / MIT | 대안(활동 둔화) |
| MoviePy | 파이썬 합성 | 15,142 / 2026-08-26 / MIT | 단순 파이프라인 |
| Wan 2.1 · 2.2 | 오픈 가중치 영상 생성 | 17,428 · 18,614 / Apache-2.0 | 참고 — 실사 · 배경 샷 |
| LTX-Video · LTX-2 | 오픈 영상 생성 | 11,376 · 10,219 / 코드 Apache-2.0, 가중치 라이선스 별도(미확인) | 참고 |
| Veo · Sora · Runway · Kling | 호스팅 | — | 참고 — 캐릭터 일관성 샷은 3D 렌더 우선 |

**프리비즈 정의**: Previsualization Society(2009) — "3D 가상 환경에서 샷 · 시퀀스의 예비 버전을 만드는
협업 과정"(2차 인용: [Post Magazine 2009](https://postmagazine.com/Press-Center/Daily-News/2009/NEW-ORGANIZATION-DEDICATED-TO-PREVIS-LAUNCHES.aspx)).
세부 유형 pitchvis · techvis · postvis([Unreal 설명](https://www.unrealengine.com/en-US/explainers/virtual-production/what-is-virtual-production)).

## 4. "rea 비디오"는 무엇인가

**[`JuneYaooo/rea-video`](https://github.com/JuneYaooo/rea-video)** (reavideo.ai) — "Reverse-engineer any
video, shot by shot: filmed, AI-generated or coded, and how to remake it." 확신 ~90%.

- 7,765 스타 · Apache-2.0(NOTICE © 2026 JuneYaooo) · 2026-10-29 생성 · 2026-11-13 push. 2주 만에 급성장,
  Trendshift 배지 — 입소문으로 들었을 가능성과 맞는다. 한국어 README 있음.
- 실제 Agent Skill · Claude Code 플러그인: `skills/rea-video/SKILL.md`(중국어) + `references/`.
- ffmpeg 위 파이썬 CLI(`rea-video decompose · summary · review`): 샷 분할 → `storyboard.jpg`, 샷별 contact sheet
  (첫 · 중간 · 끝 프레임), 오디오 파형 · 스템, 11가지 소재 유형 분류(실사 · AI · 아바타 · 3D · 2D · 스톱모션 ·
  코드 템플릿 · 화면 녹화 …), 자막, 컷 리듬 · 비트 싱크, 조명, 리메이크 레시피(Remotion 프로젝트로).
  출력은 VIDEO.md(토큰 절약용 계층 포맷).
- 대안 해석: `claude-real-video`("real video" ≈ "rea video", MIT) — 가능성 낮음. Revideo(제작 도구, 분석 아님) — 낮음.
- **주의**: Quick start 가 에이전트에게 원격 저장소를 설치 · 실행하게 한다. 0스타 유사 이름 저장소
  (`georrrgess-jpg/REAVIDEO`, `youram470-art/reavideo-*`, 2026-11-09~12 생성)는 사칭 의심 — 피한다.

**결정**: 설치하지 않는다(원격 코드 실행 · 생성 2주 차). 방법론만 각색해 `reference-video-analysis` 에
반영하고 출처를 표기했다. 실제 도입은 사용자 결정 사항(§6).

## 5. 무엇을 만들었나 — 문제 ↔ 장치

| 펭귄 작업에서 난 문제 | skill | 장치 |
|---|---|---|
| 요구사항이 숫자가 아님 | 3d-previz-edit §1 | 요구사항 → 측정 · 목표 · 카메라 기준표 + 항상 "회귀 금지" 행 |
| 하나 고치면 다른 데가 깨짐 | 3d-previz-edit §2–4 | 기준선 고정, 고정 QA 카메라(`qa_render.py`), 한 라운드 한 부위, `render_compare.py` 누수 한도(exit 1) |
| 비싼 렌더로 시행착오 | 3d-previz-edit §3 | Workbench 50% previz 로 결정, final 은 1회 |
| 날개가 머리를 뚫음 | rig-motion-clearance §1–4 | 관절 한계표 → Limit Rotation, 금지 쌍 표, `clearance_check.py`(매 프레임 · 서브프레임, 정점 그룹 단위) 미통과 시 렌더 금지 |
| 어색한 모션 | rig-motion-clearance §3–4 · reference-video-analysis | 몸 전체 회전, arc · follow-through · hold, `motion_path.py` pop/kink, 레퍼런스 timing 차트 대조 |
| 레퍼런스를 대충 봄 | reference-video-analysis | 프레임 번호 박은 추출 · 격자 · 키/breakdown/hold 표 → 모션 스펙 |
| 결과를 감으로 보고 | previz-assembly · 각 skill §보고 | 이전 · 이번 · 레퍼런스 나란히(라벨 · 프레임 번호), 숫자 기준표 |

스크립트 4개는 Blender 5.2.3 헤드리스로 직접 돌려 확인했다(관통 감지 · 정점 그룹 분리 · 서브프레임 ·
카메라 고정 · 턴테이블 · 누수 감지 · pop/kink). CI 에는 Blender 가 없어 `python/tests/test_creative_skills.py`
는 구문 · 배선 · 섹션만 검사한다.

## 6. 사용자 결정이 필요한 것

1. **rea-video 실제 설치 여부** — Apache-2.0 이라 써도 되지만, 생성 2주 차 · 원격 코드 실행. 원하면 특정 커밋을
   고정해 검토 후 도입.
2. **Remotion 사용 여부** — 회사 규모에 따라 유료. 무료 조건 밖이면 Motion Canvas/Revideo(MIT) 또는 ffmpeg.
3. **펭귄 원본 파이프라인(`assets/office/scripts/`)에 게이트 적용** — `identity_renders.py` 앞단에
   clearance_check · render_compare 를 넣을지(이번 변경 범위 밖).
4. AI 3D 생성 도입 시 Hunyuan3D 는 한국 사용 제한 라이선스 — TRELLIS(MIT) 쪽.
