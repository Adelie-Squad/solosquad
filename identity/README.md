# identity/ — SoloSquad 브랜드 아이덴티티

브랜드의 얼굴을 한곳에 모아 두는 폴더다. 지금은 **캐릭터(펭귄)** 와 **모션**, 나중에 **로고** 와 그 밖의 브랜드 에셋이 들어온다.

**눈으로 보기: [`index.html`](index.html) 을 더블클릭**(빌드 없음, `file://` 로 열린다. 라이트 · 다크는 시스템 설정을 따른다).

## 배포하지 않는다

이 폴더는 **디자인 기록**이지 제품이 아니다. 어떤 배포물에도 들어가지 않는다.

| 배포물 | 막는 곳 |
|---|---|
| npm 패키지 | `package.json` `files` 허용 목록에 없다 |
| Python 휠 | `python/src/solosquad/` 밖에 있다 |
| `curl`/`irm` 릴리스 압축본 | PRD v2.3.0 A5 표에 "제외"로 적혀 있다 |
| 웹 빌드 | Vite 는 `web/public/` 만 복사한다 |

`python/tests/test_identity_not_shipped.py`(CI python 작업)가 위 네 가지를 확인하고, `npm run docs-check` 도 `files` 를 본다.
여기 있는 그림을 제품에서 쓰려면, 제품 쪽 원본(`web/src/characters/`, `assets/office/`)에 넣는다. 여기서 복사해 가지 않는다.

## 구성

```
identity/
  README.md          이 파일
  index.html         갤러리(캐릭터 현황 · 팔레트 · 비율 · 모션 · 알려진 문제)
  character/         펭귄 — 현황 기록(spec.md) · 팔레트 · 렌더 · 턴어라운드 · 2D SVG
  motion/            동작 클립 미리보기 · 키 포즈 · 랜딩 전용 모션
  logo/              (비어 있음) 로고가 들어올 자리
```

`_build/`(Blender 원본 PNG) · `_preview/`(페이지 스크린샷)는 다시 만드는 것이라 커밋하지 않는다(`.gitignore`).

## 원본은 스크립트다

`.blend` 파일은 저장소에 두지 않는다(규격 §1). 펭귄의 원본은 **`assets/office/scripts/`** 와 **`web/src/characters/`** 이고, 여기 있는 것은 그 결과물과 기록뿐이다.

다시 만들기(Blender 5.2 · libwebp · Node):

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
$B -b -P assets/office/scripts/identity_renders.py -- --out identity/_build    # 3D 렌더 · 클립 프레임 (약 15분)
python3 assets/office/scripts/identity_pack.py identity/_build identity        # PNG → WebP · 프레임 → 움직이는 WebP
node web/scripts/identity-icons.mjs                                             # 2D 아이콘 · 마스코트 SVG (npm ci --prefix web 뒤)
```

`--only turnaround,face,bare,props,motion` 으로 일부만 다시 그릴 수 있다. 랜딩 전용 모션 그림(`motion/landing/`)은 랜딩 작업 때 찍은 프레임 시트를 옮겨 온 것이다(motion/README.md).

## 무엇을 더할 때

- **새 분야**(로고 · 글꼴 · 아이콘 세트 · 음성 등)는 폴더 하나에 `README.md` 를 둔다 — 무엇인지 · 원본이 어디인지 · 어떻게 다시 만드는지 · 언제 정했는지.
- **그림**: PNG 는 1600px 이하. 사진 같은 렌더는 WebP(q 85–90)로 줄인다. 폴더 전체를 몇 MB 안으로 유지한다. `.blend` · `.psd` · `.fig` 같은 작업 파일은 올리지 않는다(어디서 만드는지만 적는다).
- **값**(색 · 크기)은 원본(DESIGN.md · 스크립트 · 웹 코드)에서 옮겨 적고, 출처를 같이 쓴다. 여기서 먼저 바꾸지 않는다.
- `index.html` 에 섹션을 하나 더하고, 그림마다 만든 스크립트와 날짜를 캡션에 적는다.
