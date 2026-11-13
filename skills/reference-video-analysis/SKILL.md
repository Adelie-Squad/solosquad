---
name: reference-video-analysis
description: 레퍼런스 영상을 프레임 단위로 분해해 샷 목록·키 포즈·timing/spacing 차트·arc·hold 를 뽑고, 만들기 전에 샷/포즈 목록과 모션 스펙으로 바꾼다. ffmpeg 프레임 추출·장면 전환 감지·contact sheet 와 애니메이터의 timing chart 관행, rea-video 의 샷 단위 역설계 방식 기반. 사용 시점 — "이 영상처럼 만들어줘", 레퍼런스 영상·GIF·광고를 보고 모션이나 영상을 만들 때(광의), 동작 타이밍을 맞출 때, 샷 구성·컷 리듬을 따라 할 때, 만든 결과를 레퍼런스와 프레임 단위로 대조할 때(구체). (제외 — 영상 전체의 제작 방식·소재 유형·편집 레이어·사운드 역설계는 rea-video, 애니메이션 제작·관통 검사는 rig-motion-clearance, 영상 조립·렌더는 previz-assembly)
schema_version: 2
tier: member
team: _skill
category: design
used_by: ["creative", "marketer"]
dev_capability: false
triggers:
  keyword: ["레퍼런스 영상", "reference video", "프레임 분석", "frame by frame", "동작 분석", "샷 분석", "shot breakdown", "이 영상처럼", "타이밍 차트", "timing chart"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: true
  post_labeling: true
  minimum_approaches: 1
---

# Reference Video Analysis

> 레퍼런스를 "한 번 보고 느낌대로" 만들면 타이밍·포즈·리듬이 다 틀린다. 프레임을 뽑아 **숫자(프레임 번호)
> 와 그림(키 포즈)** 으로 바꾼 뒤에만 제작에 들어간다. 산출물은 제작자가 영상을 다시 보지 않아도 되는 스펙이다.

## 언제 쓰나
- 사용자가 영상·GIF·광고·다른 캐릭터 모션을 레퍼런스로 줬을 때(제작 전 필수 단계).
- 만든 모션·영상을 레퍼런스와 대조할 때(같은 절차를 결과물에도 적용해 차트를 나란히 비교).

## 입력
- 레퍼런스 파일(또는 사용자가 받아 둔 파일 경로). 온라인 영상은 사용자가 권리·다운로드를 확인한 사본만 쓴다.
- 무엇을 가져올지: 모션 타이밍 / 포즈 / 카메라·컷 리듬 / 색·조명 중 무엇인지 1줄.

## 절차

### 1. 메타데이터 — 시간축부터 고정
```bash
ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,nb_frames,width,height,duration -of csv=p=0 ref.mp4
```
- 원본 fps 를 기록(24·25·30·60). 이후 모든 프레임 번호는 **원본 fps 기준**. 우리 작업 fps 와 다르면 변환표(예: 30→24 는 ×0.8)를 같이 적는다.

### 2. 샷 나누기 + 전체 contact sheet
```bash
# 컷(장면 전환) 시각 — showinfo 의 pts_time
ffmpeg -i ref.mp4 -vf "select='gt(scene,0.3)',showinfo" -vsync vfr shots/cut_%03d.png 2> shots/cuts.log
# 전체를 1초 1장 격자 한 장으로(개요)
ffmpeg -i ref.mp4 -vf "fps=1,scale=320:-1,tile=6x5" -frames:v 1 overview.png
```
- 임계값 0.3 은 출발점 — 너무 많이/적게 잡히면 0.2–0.5 로 조정. PySceneDetect(BSD-3)가 있으면 `scenedetect -i ref.mp4 detect-adaptive list-scenes` 가 더 안정적.
- 샷마다: 시작·끝 프레임, 길이(프레임·초), 샷 크기(와이드/미디엄/클로즈업), 카메라 움직임, 소재 유형(실사·3D·2D·모션그래픽·화면 녹화) 을 표로.

### 3. 동작 구간을 프레임 단위로
```bash
# 관심 구간(예: 2.0–3.5초)만 원본 fps 그대로, 프레임 번호를 박아서
ffmpeg -ss 2.0 -to 3.5 -i ref.mp4 -vf "drawtext=text='%{frame_num}':start_number=48:x=8:y=8:fontsize=24:fontcolor=white:box=1:boxcolor=black" frames/f_%04d.png
# 같은 구간을 한 장 격자로(키 포즈 고르기용)
ffmpeg -ss 2.0 -to 3.5 -i ref.mp4 -vf "scale=240:-1,tile=8x5" -frames:v 1 frames/sheet.png
```
- `start_number` 는 구간 시작의 원본 프레임 번호(2.0초 × 24fps = 48)로 맞춰, 그림 속 번호 = 차트 번호가 되게 한다. 시스템에 따라 `drawtext` 에 `fontfile=` 이 필요하다.
- 격자 이미지를 직접 보고(이미지 읽기) 아래 §4 를 채운다. 프레임을 수십 장 따로 읽는 것보다 격자 1–3장이 싸다.

### 4. 키 포즈 · breakdown · hold · arc
| 표기 | 의미 | 기록 |
|---|---|---|
| **K (key/extreme)** | 동작 방향이 바뀌는 극점 | 프레임 번호 + 한 줄 포즈 설명 + 썸네일 |
| **B (breakdown)** | 두 키 사이 경로를 결정하는 중간 포즈 | 프레임 번호, 호의 어느 쪽으로 지나가는지 |
| **H (hold)** | 거의 움직이지 않는 구간 | 시작–끝 프레임 |
| **arc** | 끝점(손끝·머리 꼭대기·날개 끝)의 경로 | 격자 위 점 위치를 프레임별로 적어 호 모양·방향 |

**Timing/spacing 차트**: 키 사이 각 프레임의 이동 간격을 적는다 — 간격이 촘촘해지면 ease in/out, 일정하면 linear,
갑자기 크면 snap. 예:
```
K1(48) ─ . . .  .   .    .     .    .   .  . . ─ K2(60) H(60–66) ─ K3(72)
        ease-out              ease-in             hold 6f
```
필요하면 MediaPipe Pose(Apache-2.0)나 OpenCV 광류로 점 위치를 자동 추출해 간격을 수치로 낸다(선택).

### 5. 모션 스펙 / 샷 목록으로 변환 (산출물)
```markdown
## Motion spec — <클립 이름> (ref: ref.mp4, 24fps 기준)
| # | 프레임(우리 fps) | 포즈 | 주도 부위 | 간격 | 비고 |
| K1 | 1 | 날개 내림, 몸 정면 | — | — | |
| K2 | 10 | 오른 날개 최고점, 몸 8° 왼쪽 기울임 | 몸→날개(2f 지연) | ease-out | 날개 끝은 머리 바깥 호 |
| H  | 10–16 | 유지 | | hold 6f | |
| K3 | 22 | 날개 반쯤 내림 | | ease-in | 깃 끝 1f follow-through |
- 금지 쌍·최소 간격: 날개 끝 ↔ 머리 ≥ 0.012 m (rig-motion-clearance 로 검증)
- 반복: 2회, 루프 접점 프레임 1 = 마지막
```
영상(여러 샷)이면 같은 형식의 **샷 목록**: 샷# · 길이 · 샷 크기 · 앵글 · 카메라 이동 · 렌즈 · 동작 · 대사/효과음 · 전환 · 소재 유형.

### 6. 대조 (제작 후)
결과물에 §3–4 를 똑같이 적용해 차트를 나란히 놓고, `previz-assembly` 의 나란히 비교 영상(레퍼런스 | 결과, 프레임 번호)을 만든다. 키 프레임 위치 차이 ≤ 1–2프레임이 목표.

## 체크 (HARD GATE — 제작 시작 조건)
```markdown
- [ ] 원본 fps·길이 기록, 우리 fps 변환표
- [ ] 샷 목록(컷 시각 포함) 또는 단일 샷이면 그 사실
- [ ] 키 포즈마다 프레임 번호 + 썸네일, hold 구간, 주요 끝점의 arc 기록
- [ ] timing/spacing 차트(키 사이 간격 패턴)
- [ ] 모션 스펙/샷 목록이 제작자에게 넘길 형태로 완성 + 금지 쌍 명시
```

## 함정 (Gotchas)
- **fps 혼동**: 60fps 레퍼런스의 12프레임은 24fps 에서 4.8프레임이다. 번호를 옮길 때 항상 변환표.
- `-ss` 를 `-i` 앞에 두면 빠르지만 키프레임 단위로 시작이 어긋날 수 있다 — 프레임 번호가 중요하면 번호를 박은 프레임(§3)으로 확인.
- 장면 전환 감지는 빠른 카메라 이동·플래시를 컷으로 오인한다 — 격자에서 눈으로 확정.
- 레퍼런스를 그대로 베끼는 것이 목표가 아니다 — 무엇을 가져올지(입력 1줄)만 가져온다. 저작권 있는 영상의 프레임은 내부 분석용으로만 쓰고 결과물에 넣지 않는다.
- 영상 전체가 "어떻게 만들어졌나"(샷별 소재 유형·편집 레이어·사운드)는 `rea-video` 가 한다 — 여러 샷짜리 레퍼런스는 rea-video 로 샷 목록을 먼저 받고, 동작이 중요한 구간만 이 skill 로 프레임 단위 분석한다. 같은 영상을 두 skill 로 처음부터 중복 분석하지 않는다.

## 출처
- FFmpeg filters(`fps`·`select`·`showinfo`·`tile`·`drawtext`): https://ffmpeg.org/ffmpeg-filters.html
- PySceneDetect (BSD-3-Clause): https://www.scenedetect.com/docs/latest/
- JuneYaooo/rea-video (Apache-2.0, © 2026 JuneYaooo) — 샷 단위 역설계·샷별 contact sheet·소재 유형 분류·리메이크 레시피 구성을 각색(코드·문구 미복제): https://github.com/JuneYaooo/rea-video
- HUANGCHIHHUNGLeo/claude-real-video (MIT) — 중복 제거 프레임 + 격자로 "보게 하는" 방식 참고.
- Richard Williams, *The Animator's Survival Kit* — key·breakdown·timing chart·spacing. Thomas & Johnston, *The Illusion of Life*.
- MediaPipe (Apache-2.0) — 선택적 자세 추적.
