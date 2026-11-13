---
name: previz-assembly
description: 렌더 프레임·스틸을 확인용 영상으로 조립한다 — 애니매틱(스토리보드 패널에 타이밍), 턴테이블, 라운드별·레퍼런스 대비 나란히 비교 스트립(라벨·프레임 번호), 최종 클립 인코딩. ffmpeg 필터 파이프라인(concat·hstack·xstack·drawtext)과 프로그래매틱 영상(Remotion·Motion Canvas) 기반. 사용 시점 — 영상·애니메이션 결과를 사용자에게 보여 줄 때(광의), 수정 전후 비교 영상, 레퍼런스와 나란히 보기, 스토리보드를 애니매틱으로, 턴테이블 GIF·MP4, 짧은 홍보 영상 조립(구체). (제외 — 레퍼런스 분석은 reference-video-analysis, 3D 수정은 3d-previz-edit, 모션 검증은 rig-motion-clearance)
schema_version: 2
tier: member
team: _skill
category: design
used_by: ["creative", "marketer"]
dev_capability: false
triggers:
  keyword: ["애니매틱", "animatic", "비교 영상", "compare strip", "나란히 비교", "영상 조립", "영상 편집", "video edit", "ffmpeg", "remotion", "샷 리스트", "shot list", "스토리보드", "storyboard"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# Video & Previz Assembly

> 사용자는 영상을 **비교해서** 판단한다. 단독 결과물 한 편보다 "이전 | 이번 | 레퍼런스"가 같은 프레임에
> 나란히 라벨과 함께 있는 스트립이 결정을 빠르게 한다. 확인용은 싸고 빠르게(previz), 최종본은 한 번.

## 언제 쓰나
- 모션·영상·3D 결과를 사용자에게 보여 줄 때마다(확인용 previz), 그리고 최종 클립을 낼 때.

## 입력
- 프레임 폴더(`renders/rNN/…_%04d.png`) 또는 스틸·패널 이미지, 레퍼런스 영상(선택), 샷 목록(있으면).
- 목표 fps(기본 24), 출력 용도(사용자 확인 / 웹 / SNS — 비율·길이 결정).

## 절차

### 1. 애니매틱 — 패널 + 타이밍
샷 목록(`reference-video-analysis` §5)의 길이대로 패널을 붙인다. concat 목록 파일:
```text
file 'panels/s01.png'
duration 1.5
file 'panels/s02.png'
duration 0.75
file 'panels/s02.png'
```
(마지막 줄은 concat demuxer 가 마지막 duration 을 쓰도록 반복)
```bash
ffmpeg -f concat -safe 0 -i animatic.txt -vf "fps=24,format=yuv420p,drawtext=text='%{pts\:hms}':x=8:y=8:fontsize=20:fontcolor=white:box=1:boxcolor=black" animatic.mp4
```
소리(대사·음악 비트)가 있으면 `-i audio.wav -shortest` 로 붙여 컷 리듬을 같이 확인.

### 2. 비교 스트립 — 라운드 대비 / 레퍼런스 대비
```bash
# 이전 | 이번 (같은 QA 카메라, 같은 프레임 수)
ffmpeg -framerate 24 -i renders/r02/turntable_%04d.png -framerate 24 -i renders/r03/turntable_%04d.png \
  -filter_complex "[0]drawtext=text='r02':x=10:y=10:fontsize=28:fontcolor=white:box=1:boxcolor=black[a];\
[1]drawtext=text='r03':x=10:y=10:fontsize=28:fontcolor=white:box=1:boxcolor=black[b];[a][b]hstack=inputs=2,format=yuv420p" \
  compare_r02_r03.mp4
# 레퍼런스 | 결과 | 이전 — 크기 맞춘 뒤 3열, 프레임 번호 표시
ffmpeg -i ref.mp4 -framerate 24 -i renders/r03/anim_%04d.png -framerate 24 -i renders/r02/anim_%04d.png \
  -filter_complex "[0]fps=24,scale=-2:480[r];[1]scale=-2:480[n];[2]scale=-2:480[o];\
[r][n][o]hstack=inputs=3,drawtext=text='%{frame_num}':x=10:y=h-40:fontsize=24:fontcolor=white:box=1:boxcolor=black,format=yuv420p" \
  compare_ref.mp4
```
- 2×2 이상은 `xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0`.
- 정지 비교(보고서용)는 같은 필터에 `-frames:v 1` 또는 `tile` 로 키 프레임만 한 장에.
- 입력들의 fps·해상도가 다르면 hstack 이 실패한다 — 먼저 `fps=`·`scale=` 로 맞춘다.

### 3. 턴테이블 · 루프
```bash
ffmpeg -framerate 24 -i renders/r03/turntable_%04d.png -vf "format=yuv420p" -movflags +faststart turntable.mp4
# GIF (팔레트 2-pass 로 밴딩 방지)
ffmpeg -i turntable.mp4 -vf "fps=15,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" turntable.gif
```
루프 클립은 첫 프레임 = 마지막 프레임 + 1 이 되게 렌더(마지막 프레임 중복 금지 — 루프에서 멈칫).

### 4. 최종 인코딩 (웹·SNS)
- 웹 기본: H.264 `-c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p -movflags +faststart`; 투명 필요 시 VP9 `-c:v libvpx-vp9 -pix_fmt yuva420p` (WebM).
- 비율: 가로 16:9, 세로(릴스·쇼츠) 9:16 — 세로판은 재구도(카메라를 다시 잡기)가 크롭보다 낫다.
- 자막·텍스트·로고가 반복되거나 데이터로 바뀌는 영상(여러 버전 광고, 템플릿 영상)은 프로그래매틱으로:
  - **Remotion**(React) — 공식 Agent Skills `remotion-dev/skills` 가 있다. ⚠️ 라이선스: 개인·직원 3명 이하 영리 회사·비영리는 무료, 그보다 큰 회사는 유료 Company License — 사용 전 사용자 확인.
  - **Motion Canvas**·**Revideo**(MIT) — 라이선스 제약 없는 대안. 단순 합성은 ffmpeg/MoviePy(MIT)로 충분.
- AI 영상 생성(Veo·Sora·Runway·Kling, 오픈 가중치 Wan 2.x·LTX)은 실사·배경 샷에 한정 — 캐릭터 일관성이 필요한 샷은 3D 렌더 우선. 생성 결과도 §2 비교 스트립으로 레퍼런스와 대조.

### 5. 보고
- 확인용 영상 경로 + 무엇을 비교하는지 한 줄 + 확인해 달라는 프레임 번호(예: "12–16프레임 날개 끝 경로").
- 최종본: 해상도·fps·길이·코덱·용량.

## 체크
```markdown
- [ ] 비교 영상의 각 열에 라벨(라운드/레퍼런스)과 프레임 번호가 보인다
- [ ] 비교 대상들이 같은 카메라·같은 fps·같은 프레임 범위다
- [ ] 애니매틱 길이 = 샷 목록 길이 합 (±1프레임)
- [ ] 최종본: yuv420p(또는 의도한 알파), faststart, 요청 비율
- [ ] Remotion 사용 시 라이선스 조건을 사용자에게 확인
```

## 함정 (Gotchas)
- `format=yuv420p` 를 빼면 일부 브라우저·메신저에서 재생이 안 된다.
- `drawtext` 는 빌드에 따라 `fontfile=` 이 필요하고, 필터 안 `:`·`'`·`,` 는 이스케이프가 필요하다 — 복잡하면 `-filter_complex_script file.txt`.
- 이미지 시퀀스는 `-framerate`(입력) 와 `fps=`(필터) 를 혼동하지 말 것 — 입력 fps 를 안 주면 25 로 읽는다.
- 확인용에 최종 품질 렌더를 쓰지 않는다 — previz 프레임으로 충분하고, 결정 후 최종 렌더 1회.

## 출처
- FFmpeg filters(`concat`·`hstack`·`xstack`·`drawtext`·`palettegen`·`paletteuse`): https://ffmpeg.org/ffmpeg-filters.html · concat demuxer: https://ffmpeg.org/ffmpeg-formats.html#concat
- Remotion 라이선스: https://www.remotion.dev/docs/license · Remotion Agent Skills: https://www.remotion.dev/docs/ai/skills
- Motion Canvas (MIT): https://motioncanvas.io · Revideo (MIT): https://github.com/redotvideo/revideo · MoviePy (MIT)
- 프리비즈(previs) 정의 — Previsualization Society(2009): 3D 가상 환경에서 샷·시퀀스의 예비 버전을 만드는 협업 과정.
