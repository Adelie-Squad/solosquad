# SoloSquad 툰 오피스 제작 가이드

웹에서 아이소메트릭 3D 사무실을 만들고, SoloSquad 에이전트를 펭귄 캐릭터로 띄우는 방법을 정리한 문서입니다. 데모(v3)에서 실제로 쓴 코드와 수치를 기준으로 작성했습니다.

- 목표 룩: 키캡 도시 일러스트 레퍼런스(면 방향 3톤, 잉크선, 올리브 단색 그림자)
- 캐릭터 레퍼런스: 봉제 펭귄 키링(납작하고 통통한 실루엣, 하트 모양 흰 얼굴, 마젠타 볼, 스티치)
- 동작 원칙: 에이전트는 자리를 이동하지 않고 제자리 모션으로 상태를 보여 줌

---

## 목차

1. [기술 스택](#1-기술-스택)
2. [룩을 만드는 다섯 가지 규칙](#2-룩을-만드는-다섯-가지-규칙)
3. [팔레트](#3-팔레트)
4. [면 방향 3톤 셰이더](#4-면-방향-3톤-셰이더)
5. [키캡 블록: 둥근 모서리와 테이퍼](#5-키캡-블록-둥근-모서리와-테이퍼)
6. [잉크선: 두 가지 굵기의 후처리](#6-잉크선-두-가지-굵기의-후처리)
7. [단색 그림자](#7-단색-그림자)
8. [펭귄 에이전트 조립](#8-펭귄-에이전트-조립)
9. [제자리 모션과 상태 매핑](#9-제자리-모션과-상태-매핑)
10. [SoloSquad 상태 파일 연결](#10-solosquad-상태-파일-연결)
11. [React Three Fiber로 옮기기](#11-react-three-fiber로-옮기기)
12. [영상 프리토타입: Blender 파이프라인](#12-영상-프리토타입-blender-파이프라인)
13. [자주 걸리는 함정](#13-자주-걸리는-함정)
14. [참고 도구와 에셋](#14-참고-도구와-에셋)

---

## 1. 기술 스택

| 레이어 | 선택 | 비고 |
|---|---|---|
| 렌더링 | three.js r160 | 데모는 단일 HTML. 프로젝트에서는 React Three Fiber + drei |
| 카메라 | `OrthographicCamera` | 위치 `(10, 8.6, 10)`, 원근 없음 |
| 셰이딩 | 커스텀 `ShaderMaterial` | 빛 계산 없이 면 방향으로 색 지정 |
| 외곽선 | 후처리 2패스 | 색+깊이 1회, 법선 1회 렌더 후 합성 |
| 그림자 | `ShadowMaterial` 평면 | 바닥과 베이스 윗면에만 받음 |
| 이름표 | HTML 오버레이 | 3D 좌표를 화면 좌표로 투영해 `div` 배치 |
| 상태 | Zustand(프로젝트) | 3D와 UI가 같은 스토어 구독 |
| 이벤트 | Node + chokidar + ws | `state/*.json` 변경을 WebSocket으로 push |

외부 3D 모델 파일은 쓰지 않습니다. 모든 오브젝트를 Box, Cylinder, Sphere, Lathe, Extrude 같은 프리미티브로 만듭니다.

---

## 2. 룩을 만드는 다섯 가지 규칙

처음 버전은 게임식 툰 셰이딩이라 레퍼런스와 다르게 보였습니다. 일러스트 룩은 아래 다섯 가지에서 나옵니다.

| 요소 | 게임식 툰 (피해야 할 것) | 일러스트 룩 (목표) |
|---|---|---|
| 명암 | 빛 각도로 계산한 단계 명암. 회색으로 탁해짐 | 면 방향별 고정색. 윗면 베이지, 왼면 흰색, 오른면 올리브 |
| 외곽선 | 부풀린 뒷면 껍데기라 실루엣에만 선 | 후처리 엣지 검출. 바깥 윤곽은 굵게, 안쪽 모서리는 얇게 |
| 그림자 | 반투명 회색, 가장자리 흐림 | 올리브 단색, 가장자리 딱 끊김, 한 방향으로 길게 |
| 팔레트 | 10색 이상 | 베이지 계열 + 라임 + 파랑 + 마젠타 + 검정 |
| 공간 | 벽과 바닥이 있는 방 | 벽 없이 키캡 블록 위 디오라마, 무한 단색 바닥 |

---

## 3. 팔레트

레퍼런스 이미지에서 픽셀을 직접 찍어 뽑은 값입니다. 오브젝트마다 `[윗면, 왼면, 오른면]` 3색을 한 세트로 정의합니다.

```js
const P = {
  bg: '#D0C5A7', ink: '#111008',
  cream:  ['#E1DBC5', '#F0EDE8', '#7E6E3B'],  // 블록 기본
  white:  ['#F4F1EA', '#F0EDE8', '#7E6E3B'],
  lime:   ['#B3D64A', '#9AC22D', '#6E8A1F'],  // 나무
  black:  ['#2A2925', '#151410', '#0B0A07'],
  blue:   ['#4A8CF0', '#2C74E0', '#1B4FA6'],  // 포인트
  glass:  ['#2C74E0', '#0E2A1A', '#08180F'],  // 유리 돔
  lens:   ['#DDEBFB', '#C9DDF6', '#8FB0D8'],  // 돋보기 렌즈
  // 펭귄 전용
  pblack: ['#3D3B35', '#2B2A26', '#1C1B17'],  // 잉크선과 구분되게 살짝 밝게
  pwhite: ['#FAF8F3', '#F3F0EA', '#C9BD98'],  // 그늘을 부드럽게
  pink:   ['#F25CC8', '#E01FAE', '#A8137F'],  // 볼
  eye:    ['#1C1B17', '#151410', '#0F0E0B']   // 눈은 거의 단색
};
```

| 이름 | 값 | 용도 |
|---|---|---|
| 바닥 | `#D0C5A7` | 배경, 무한 바닥 |
| 윗면 | `#E1DBC5` | 블록 윗면 |
| 왼면 | `#F0EDE8` | 카메라 기준 왼쪽(+z) 면 |
| 오른면 | `#7E6E3B` | 카메라 기준 오른쪽(+x) 면 |
| 그림자 | `#766F53` | 바닥 위 그림자 결과색 |
| 라임 | `#9AC22D` | 나무 |
| 파랑 | `#2C74E0` | 포인트, 작업 중 상태 |
| 마젠타 | `#E01FAE` | 펭귄 볼 |
| 잉크 | `#111008` | 모든 선 |

지정한 hex가 화면에 그대로 나오도록 색 관리를 끕니다.

```js
THREE.ColorManagement.enabled = false;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
```

---

## 4. 면 방향 3톤 셰이더

룩의 절반은 이 셰이더에서 나옵니다. 법선이 위를 보면 윗면색, 카메라 기준 오른쪽(+x)을 보면 오른면색, 나머지는 왼면색입니다. 구나 원기둥에도 같은 규칙이 적용되어 색 띠 3개로 나뉩니다.

```js
const toneU = { value: 1 };  // 0이면 왼면색 단색 (비교용 토글)

function toneMat([top, lit, shade]) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTop:   { value: new THREE.Color(top) },
      uLit:   { value: new THREE.Color(lit) },
      uShade: { value: new THREE.Color(shade) },
      uTone:  toneU
    },
    vertexShader: /* glsl */`
      varying vec3 vN;
      void main() {
        // 비균일 scale(타원체)에서도 맞는 월드 법선
        vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTop, uLit, uShade;
      uniform float uTone;
      varying vec3 vN;
      void main() {
        vec3 n = normalize(vN);
        float right = smoothstep(-0.08, 0.08, n.x - n.z);  // +x 쪽 면
        float top   = smoothstep(0.55, 0.65, n.y);         // 윗면
        vec3 c = mix(mix(uLit, uShade, right), uTop, top);
        gl_FragColor = vec4(mix(uLit, c, uTone), 1.0);
      }`
  });
}
```

- 카메라가 `(10, y, 10)`에 있으므로 화면 왼쪽에 보이는 면은 +z, 오른쪽에 보이는 면은 +x입니다.
- 캐릭터 얼굴이 반으로 갈라지지 않게, 캐릭터는 +z 쪽(밝은 면)을 보게 두고 `rotation.y = 0.28` 정도만 카메라 쪽으로 돌립니다.
- `mat3(modelMatrix)`를 그대로 쓰면 타원체에서 색 띠가 어긋납니다. 반드시 normal matrix(`transpose(inverse(...))`)를 씁니다.

---

## 5. 키캡 블록: 둥근 모서리와 테이퍼

레퍼런스 키캡의 인상은 세 가지에서 나옵니다.

1. 둥근 모서리
2. 윗면 테두리 선
3. 위로 갈수록 좁아지는 옆면

`ExtrudeGeometry`로 둥근 사각형을 뽑고, 베벨을 2단으로 주면 윗면 테두리에 잉크선이 정확히 한 줄 생깁니다. 베벨 면의 법선이 22.5°와 67.5°로 나뉘고, 그 사이 45° 꺾임만 크리스 임계값(41°)을 넘기 때문입니다.

```js
function keycap(w, h, d, r, inset, bev) {
  const sw = w - 2 * bev, sd = d - 2 * bev, rr = Math.max(0.01, r - bev);
  const x0 = -sw / 2, y0 = -sd / 2;
  const s = new THREE.Shape();
  s.moveTo(x0 + rr, y0);
  s.lineTo(x0 + sw - rr, y0);      s.absarc(x0 + sw - rr, y0 + rr, rr, -Math.PI / 2, 0, false);
  s.lineTo(x0 + sw, y0 + sd - rr); s.absarc(x0 + sw - rr, y0 + sd - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x0 + rr, y0 + sd);      s.absarc(x0 + rr, y0 + sd - rr, rr, Math.PI / 2, Math.PI, false);
  s.lineTo(x0, y0 + rr);           s.absarc(x0 + rr, y0 + rr, rr, Math.PI, Math.PI * 1.5, false);

  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.001, h - 2 * bev),
    bevelEnabled: true, bevelThickness: bev, bevelSize: bev,
    bevelSegments: 2,   // 테두리 선 한 줄
    curveSegments: 8    // 모서리 곡선은 11°씩 → 선 없이 매끈
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bev, 0);

  // 높이 비율 t에 따라 위쪽 정점을 안으로 → 테이퍼
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.max(0, p.getY(i)) / h;
    p.setX(i, p.getX(i) * (1 - t * 2 * inset / w));
    p.setZ(i, p.getZ(i) * (1 - t * 2 * inset / d));
  }
  g.computeVertexNormals();
  return g;  // 바닥이 y=0
}
```

데모에서 쓴 값:

| 오브젝트 | w × h × d | radius | inset | bevel |
|---|---|---|---|---|
| 베이스 | 7.8 × 0.6 × 6.0 | 0.5 | 0.25 | 0.09 |
| 책상 | 1.35 × 0.42 × 0.72 | 0.14 | 0.05 | 0.05 |
| 서버 포드 | 1.1 × 0.42 × 1.1 | 0.22 | 0.05 | 0.05 |
| 키오스크 | 1.15 × 0.7 × 0.92 | 0.16 | 0.05 | 0.05 |
| 노트북 뚜껑 | 0.56 × 0.3 × 0.03 | 0.04 | 0 | 0.01 |
| 토피어리 잎 | 0.4 × 0.55 × 0.4 | 0.2 | 0 | 0.05 |

`curveSegments` 8은 유지하세요. 4 이하로 내리면 곡선 모서리 꺾임마다 선이 생깁니다.

---

## 6. 잉크선: 두 가지 굵기의 후처리

장면을 두 번 렌더링한 뒤, 화면 전체를 덮는 사각형에서 선을 찾아 칠합니다.

- **바깥 윤곽(실루엣):** 이웃 픽셀과 깊이가 크게 다른 곳. 굵게 칠합니다.
- **안쪽 모서리(크리스):** 이웃 픽셀과 법선 각도가 크게 다른 곳. 실루엣의 절반 반경으로 얇게 칠합니다.

선 두께가 화면 픽셀 기준이라 확대해도 일정합니다.

### 렌더 타깃

```js
const PR = 2;  // 1x 화면에서도 2배로 그려 안티에일리어싱 효과
renderer.setPixelRatio(PR);

const rtColor  = new THREE.WebGLRenderTarget(w * PR, h * PR, { depthTexture: new THREE.DepthTexture(w * PR, h * PR) });
const rtNormal = new THREE.WebGLRenderTarget(w * PR, h * PR);
const normalMat = new THREE.MeshNormalMaterial();
```

### 매 프레임

```js
renderer.shadowMap.autoUpdate = false;

function render() {
  renderer.shadowMap.needsUpdate = true;          // 그림자 맵은 색 패스에서 한 번만
  renderer.setRenderTarget(rtColor);
  renderer.render(scene, camera);

  const bg = scene.background;
  scene.background = null;
  scene.overrideMaterial = normalMat;
  renderer.setClearColor(0x8080ff, 1);
  renderer.setRenderTarget(rtNormal);
  renderer.render(scene, camera);
  scene.overrideMaterial = null;
  scene.background = bg;

  renderer.setRenderTarget(null);
  renderer.render(quadScene, quadCam);            // 합성 패스
}
```

### 합성 셰이더

```glsl
uniform sampler2D tColor, tNormal, tDepth;
uniform vec2 uTexel;          // 1 / 렌더 타깃 크기
uniform float uThick;         // 1.45 * PR
uniform float uNear, uFar, uOutline;
uniform vec3 uInk;
varying vec2 vUv;

// 직교 카메라라 깊이가 선형 → 바로 월드 거리로 환산
float dep(vec2 uv) { return uNear + texture2D(tDepth, uv).x * (uFar - uNear); }
vec3  nor(vec2 uv) { return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0); }

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float dc = dep(vUv);
  vec3  nc = nor(vUv);
  float sil = 0.0, crease = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235988;               // 30°씩 12방향
    vec2 d = vec2(cos(a), sin(a)) * uTexel;
    sil    = max(sil,    step(0.14, abs(dep(vUv + d * uThick) - dc)));
    crease = max(crease, step(0.25, 1.0 - dot(nor(vUv + d * uThick * 0.5), nc)));
  }
  gl_FragColor = vec4(mix(col, uInk, max(sil, crease) * uOutline), 1.0);
}
```

| 파라미터 | 값 | 의미 |
|---|---|---|
| `uThick` | `1.45 * PR` | 실루엣 샘플 반경. 선 굵기 약 2.9 CSS px |
| 크리스 반경 | `uThick * 0.5` | 안쪽 모서리 선은 절반 굵기 |
| 깊이 임계값 | `0.14` | 월드 단위. 낮추면 바닥 경사에서도 선이 생김 |
| 법선 임계값 | `0.25` | `1 - cos(41°)`. 41°보다 크게 꺾인 모서리에만 선 |

---

## 7. 단색 그림자

물체 자체는 그림자를 받지 않고, 바닥과 베이스 윗면에 깐 `ShadowMaterial` 평면만 그림자를 받습니다. 그래야 면 톤이 그림자에 오염되지 않습니다.

```js
const shadowMat = new THREE.ShadowMaterial({ color: '#1C1900', opacity: 0.5 });

function shadowPlane(w, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), shadowMat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
}
shadowPlane(90, 90, 0, 0, 0);                      // 무한 바닥
shadowPlane(BW - 0.75, BD - 0.75, 0, H + 0.004, 0); // 베이스 윗면 (살짝 띄움)

const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.set(-9, 6.4, 2.6);                    // 그림자가 화면 오른쪽 아래로 길게
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);                // 가장자리를 딱 끊기게
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.012;
```

그림자색 계산: `#1C1900`을 50%로 바닥 `#D0C5A7` 위에 섞으면 레퍼런스 그림자색 `#766F53`이 나옵니다. 다른 바닥색을 쓰면 `그림자색 = 2 × 목표색 − 바닥색`으로 다시 구합니다.

---

## 8. 펭귄 에이전트 조립

### 8.1 부품 구성

| 부품 | 만드는 법 | 핵심 수치 |
|---|---|---|
| 몸통 | `LatheGeometry`로 서양배 단면을 돌리고 앞뒤를 0.74배로 눌러 납작하게 | 높이 1.19, 최대 반경 0.47 |
| 얼굴 패널 | 몸통 셰이더 안에서 하트 영역을 흰색으로 칠함(SDF) | 타원 1 + 원 2 합집합 |
| 눈 | 몸 표면에 반쯤 묻힌 세로 타원, `eye` 팔레트 | r 0.09, scale (0.95, 1.22, 0.42) |
| 볼 | 눈 바깥 아래 마젠타 타원 | r 0.07, scale (1.25, 0.85, 0.35) |
| 부리 | 납작한 팔면체. 가운데 꺾임에 선이 생겨 입이 됨 | r 0.075, scale (1.2, 0.8, 0.62) |
| 날개 | 어깨 피벗 그룹 아래 납작한 타원 | 피벗 (±0.41, 0.74, 0) |
| 발 | 바닥에 납작한 타원 두 개 | r 0.12, scale (1.05, 0.42, 1.3) |

### 8.2 몸통 단면

```js
function lathe(pts, zScale) {
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 56, Math.PI);
  g.scale(1, 1, zScale);    // 납작하게
  g.computeVertexNormals();
  return g;
}
// phiStart = π → 이음매가 뒤쪽으로 가서 얼굴에 선이 생기지 않음
const BODY = lathe([
  [0.001, 0.04], [0.30, 0.06], [0.43, 0.19], [0.47, 0.41],
  [0.45, 0.65],  [0.39, 0.87], [0.29, 1.05], [0.15, 1.16], [0.001, 1.19]
], 0.74);
```

### 8.3 얼굴 패널은 메시가 아니라 셰이더로

흰 얼굴을 별도 메시로 겹치면 겹친 경계마다 잉크선이 생깁니다. 그러면 눈 주변에 흰 링이 생겨 흰자 위에 동공을 올린 것처럼 보입니다. 몸통 셰이더에서 직접 칠하면 이 문제가 없고, 테두리 잉크선과 스티치 점선까지 깔끔하게 넣을 수 있습니다.

```glsl
uniform vec3 bTop, bLit, bShade;   // 검은 몸 3톤
uniform vec3 wTop, wLit, wShade;   // 흰 얼굴 3톤
uniform vec3 uInk, uStitch;        // 잉크, 스티치(#8E8676)
uniform float uTone, uOutline;
varying vec3 vN;
varying vec3 vP;                   // 오브젝트 좌표 (vertex에서 position 전달)

float sdE(vec2 p, vec2 c, vec2 r) { vec2 q = (p - c) / r; return (length(q) - 1.0) * min(r.x, r.y); }
float sdC(vec2 p, vec2 c, float r) { return length(p - c) - r; }

void main() {
  vec3 n = normalize(vN);
  float right = smoothstep(-0.08, 0.08, n.x - n.z);
  float top   = smoothstep(0.55, 0.65, n.y);

  // 하트 얼굴 = 아래 타원 + 이마 원 두 개. 두 원 사이로 검은 몸이 V자로 내려옴
  vec2 p = vP.xy;
  float d = min(sdE(p, vec2(0.0, 0.43), vec2(0.405, 0.39)),
            min(sdC(p, vec2(-0.155, 0.85), 0.175),
                sdC(p, vec2( 0.155, 0.85), 0.175)));
  float front  = step(0.04, vP.z);                         // 앞면에만
  float inside = front * (1.0 - smoothstep(-0.003, 0.003, d));

  vec3 lit = mix(bLit,   wLit,   inside);
  vec3 sh  = mix(bShade, wShade, inside);
  vec3 tp  = mix(bTop,   wTop,   inside);
  vec3 c = mix(mix(lit, sh, right), tp, top);
  c = mix(lit, c, uTone);

  // 스티치: 경계 안쪽 0.036에 점선
  float dash = step(0.0, sin(atan(p.y - 0.5, p.x) * 72.0));
  float st = inside * (1.0 - smoothstep(0.004, 0.007, abs(d + 0.036))) * dash;
  c = mix(c, uStitch, st * 0.9);

  // 패널 테두리 잉크선
  float border = front * (1.0 - smoothstep(0.009, 0.013, abs(d)));
  c = mix(c, uInk, border * uOutline);

  gl_FragColor = vec4(c, 1.0);
}
```

얼굴 위 부품은 몸 표면 깊이에 맞춰 z를 정합니다. 표면 깊이는 `z = 0.74 × sqrt(r(y)² − x²)`로 구하고, `r(y)`는 몸통 단면 반경입니다.

| 부품 | 위치 (x, y, z) |
|---|---|
| 눈 | (±0.155, 0.86, 0.275) |
| 볼 | (±0.27, 0.69, 0.25) |
| 부리 | (0, 0.73, 0.315) |
| 나비넥타이 중심 | (0, 0.55, 0.36) |

### 8.4 에이전트별 소품

몸은 하나의 함수로 공유하고, 소품만 붙였다 뗍니다. 에이전트를 늘려도 몸 코드는 그대로입니다.

| 에이전트 | 소품 | 구성 | 대표색 |
|---|---|---|---|
| 기획 PM | 나비넥타이 | 4각 원뿔 2개를 마주 보게 + 매듭 구 | 파랑 |
| 리서처 | 동그란 안경 | Torus 2개 + 콧대 원기둥 + 다리 박스 2개 | 라임 |
| 검증관 | 돋보기 | 오른 날개 피벗에 붙인 손잡이 + Torus 테 + 렌즈 원판 | 마젠타 |

```js
if (a.prop === 'bowtie') {
  [-1, 1].forEach((s) => {
    mk(new THREE.ConeGeometry(0.075, 0.15, 4), 'blue', [s * 0.075, 0.55, 0.345], rig,
       { rot: [Math.PI / 4, 0, s * Math.PI / 2], scale: [1, 1, 0.5] });
  });
  mk(sph(0.038, 16, 10), 'blue', [0, 0.55, 0.36], rig);
}
if (a.prop === 'glasses') {
  [-1, 1].forEach((s) => {
    mk(new THREE.TorusGeometry(0.13, 0.021, 10, 36), 'black', [s * 0.155, 0.86, 0.31], rig);
    mk(box(0.02, 0.02, 0.22), 'black', [s * 0.29, 0.87, 0.19], rig);
  });
  mk(cyl(0.015, 0.015, 0.06, 8), 'black', [0, 0.88, 0.32], rig, { rot: [0, 0, Math.PI / 2] });
}
if (a.prop === 'magnifier') {
  const tool = new THREE.Group();
  tool.position.set(0.06, -0.36, 0.13);   // 날개 끝
  tool.rotation.z = -0.35;
  wings[1].add(tool);                     // 날개를 따라 움직임
  mk(cyl(0.022, 0.026, 0.24, 8), 'black', [0, 0.03, 0], tool);
  mk(new THREE.TorusGeometry(0.14, 0.026, 10, 36), 'black', [0, 0.29, 0], tool);
  mk(cyl(0.13, 0.13, 0.012, 36), 'lens', [0, 0.29, 0], tool, { rot: [Math.PI / 2, 0, 0] });
}
```

추가 소품 아이디어: 헤드셋(운영 에이전트), 비니(디자이너), 클립보드(QA), 넥타이 대신 스카프. 모두 프리미티브 2~3개로 만들 수 있습니다.

### 8.5 배치

에이전트는 책상 뒤에 서고, 노트북 뚜껑 등이 카메라 쪽을 봅니다. 뚜껑이 얼굴을 가리지 않도록 아래 값을 지킵니다.

| 항목 | 값 |
|---|---|
| 책상 z | 0.25 |
| 에이전트 z | -0.8 |
| 뚜껑 높이 / 기울기 | 0.3 / -0.42 rad |
| 에이전트 회전 | `rotation.y = 0.28` |

뚜껑 등의 스티커 색을 에이전트 대표색으로 맞추면, 캐릭터가 가려져도 누구 자리인지 알 수 있습니다.

---

## 9. 제자리 모션과 상태 매핑

에이전트는 자리를 지키고 모션만 바꿉니다. 모션 파라미터를 목표값으로 지수 보간해서 상태가 바뀌어도 튀지 않게 합니다.

### 9.1 모션 파라미터

| 파라미터 | 적용 대상 | 의미 |
|---|---|---|
| `hop` | `rig.position.y` | 점프 높이 |
| `lean` | `rig.rotation.x` | 앞뒤 기울기 |
| `sway` | `rig.rotation.z` | 좌우 기울기 |
| `squash` | `rig.scale` | 찌그러짐 (y 감소, x·z 증가) |
| `wl`, `wr` | 왼/오른 날개 피벗 `rotation.z` | 날개 벌림 각도 |
| `wfx` | 양 날개 피벗 `rotation.x` | 날개를 앞으로 뻗기 |
| `look` | 눈 `position.y` | 시선 위아래 |

### 9.2 상태별 목표값

| 상태 | 라벨 | 모션 | 라벨색 |
|---|---|---|---|
| `typing` | 작업 중 | 앞으로 살짝 숙이고 양 날개로 번갈아 타자 | `#2C74E0` |
| `thinking` | 생각 중 | 몸을 좌우로 천천히 기울이고 눈이 위를 봄 | `#6A6454` |
| `waiting` | 승인 대기 | 한쪽 날개를 높이 들고 흔들며 작게 콩콩 | `#C9711F` |
| `done` | 완료 | 양 날개를 들고 점프, 착지할 때 찌그러짐 | `#5E7F12` |

```js
function target(a, t) {
  const p = a.phase;  // 에이전트마다 다른 위상 → 동작이 겹치지 않음
  switch (a.state) {
    case 'typing': {
      const k = t * 13 + p;
      return { lean: 0.1, sway: 0, hop: Math.abs(Math.sin(k)) * 0.012, squash: 0,
               wl: 0.32 + Math.max(0,  Math.sin(k)) * 0.18,
               wr: 0.32 + Math.max(0, -Math.sin(k)) * 0.18,
               wfx: -0.75, look: -0.01 };
    }
    case 'thinking':
      return { lean: -0.04, sway: Math.sin(t * 1.5 + p) * 0.11, hop: 0,
               squash: Math.sin(t * 2 + p) * 0.012, wl: 0.12, wr: 0.12, wfx: 0, look: 0.022 };
    case 'waiting': {
      const h = Math.max(0, Math.sin(t * 5 + p));
      return { lean: 0, sway: 0, hop: h * 0.06, squash: 0,
               wl: 0.18, wr: 2.35 + Math.sin(t * 9 + p) * 0.35, wfx: 0, look: 0.01 };
    }
    case 'done': {
      const s = Math.sin(t * 6.5 + p);
      return { lean: 0, sway: 0, hop: Math.max(0, s) * 0.26,
               squash: s < -0.6 ? (-0.6 - s) * 0.18 : 0,
               wl: 1.3 + Math.sin(t * 13) * 0.35, wr: 1.3 + Math.sin(t * 13 + 1) * 0.35,
               wfx: 0, look: 0.015 };
    }
  }
}

function animate(dt, t) {
  const k = 1 - Math.exp(-9 * dt);              // 프레임레이트와 무관한 보간
  for (const a of agents) {
    const g = target(a, t), m = a.m;
    for (const key in g) m[key] += (g[key] - m[key]) * k;

    a.rig.position.y = m.hop;
    a.rig.rotation.x = m.lean;
    a.rig.rotation.z = m.sway;
    a.rig.scale.set(1 + m.squash * 0.6, 1 - m.squash, 1 + m.squash * 0.6);
    a.wings[0].rotation.z = -m.wl;
    a.wings[1].rotation.z =  m.wr;
    a.wings[0].rotation.x = a.wings[1].rotation.x = m.wfx;

    // 깜빡임: 2.6~5초 간격, 0.13초 동안 눈을 납작하게
    let open = 1;
    if (t > a.blinkAt) {
      open = 0.12;
      if (t > a.blinkAt + 0.13) a.blinkAt = t + 2.6 + Math.random() * 2.4;
    }
    a.eyes.forEach((e) => { e.scale.y = 1.22 * open; e.position.y = 0.86 + m.look; });
  }
}
```

날개 회전 방향: 왼쪽 날개는 `rotation.z`가 음수일 때, 오른쪽 날개는 양수일 때 바깥으로 벌어집니다.

---

## 10. SoloSquad 상태 파일 연결

에이전트 코드는 건드리지 않습니다. 상태 파일을 관찰만 합니다.

```
SoloSquad 에이전트 ──쓰기──▶ state/*.json
                                   │ chokidar watch
                                   ▼
                          Node 서버 (ws)
                                   │ WebSocket push
                                   ▼
                    브라우저 스토어 (Zustand)
                                   │ 구독
                                   ▼
                 펭귄 a.state 변경 → 제자리 모션 전환
```

### 서버

```js
// server.js
import fs from 'node:fs';
import chokidar from 'chokidar';
import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ port: 8787 });

chokidar.watch('state/*.json', { awaitWriteFinish: true }).on('change', (file) => {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    const msg = JSON.stringify({ agent: s.agent, status: s.status, note: s.note, at: Date.now() });
    wss.clients.forEach((c) => c.readyState === 1 && c.send(msg));
  } catch { /* 쓰는 도중 읽힌 경우 무시 */ }
});
```

### 상태 파일 형식 (제안)

```json
{
  "agent": "pm",
  "status": "typing",
  "note": "brief.md 작성"
}
```

### SoloSquad 이벤트 → 상태 매핑

| SoloSquad 이벤트 | `status` |
|---|---|
| 파일 작성, 도구 호출 | `typing` |
| 추론 중, 다른 에이전트 응답 대기 | `thinking` |
| 사람 승인 필요 | `waiting` |
| 작업 완료, 결과 저장 | `done` |

### 클라이언트

```js
const ws = new WebSocket('ws://localhost:8787');
ws.onmessage = (e) => {
  const { agent, status, note } = JSON.parse(e.data);
  const a = byId[agent];
  if (!a || !STATE[status]) return;
  a.state = status;
  renderTag(a);
  logEvent(a, status, note);
};
```

---

## 11. React Three Fiber로 옮기기

| 데모 (vanilla) | R3F |
|---|---|
| `toneMat()` | drei `shaderMaterial`로 `FaceToneMaterial` 등록 후 `extend` |
| 펭귄 몸통 셰이더 | 같은 방식으로 `PenguinBodyMaterial` 등록 |
| 2패스 잉크선 | `@react-three/postprocessing`의 `EffectComposer` + 커스텀 `Effect` (`NormalPass`로 법선 텍스처) |
| `keycap()` | `useMemo(() => keycap(...), [])`로 지오메트리 캐시 |
| 이름표 오버레이 | drei `<Html>` |
| 애니메이션 루프 | `useFrame((state, dt) => animate(dt, state.clock.elapsedTime))` |
| 상태 | Zustand 스토어를 WebSocket 핸들러가 갱신 |

```jsx
import { shaderMaterial, Html } from '@react-three/drei';
import { extend, Canvas, useFrame } from '@react-three/fiber';

const FaceToneMaterial = shaderMaterial(
  { uTop: new THREE.Color(), uLit: new THREE.Color(), uShade: new THREE.Color(), uTone: 1 },
  vertexShader,    // 4장의 vertex
  fragmentShader   // 4장의 fragment
);
extend({ FaceToneMaterial });

<Canvas orthographic shadows camera={{ position: [10, 8.6, 10], zoom: 70 }} flat linear>
  <directionalLight castShadow position={[-9, 6.4, 2.6]} shadow-mapSize={[4096, 4096]} />
  <mesh geometry={deskGeo} castShadow>
    <faceToneMaterial uTop="#E1DBC5" uLit="#F0EDE8" uShade="#7E6E3B" />
  </mesh>
</Canvas>
```

- `<Canvas flat linear>`가 톤매핑과 sRGB 변환을 꺼서 색 관리 비활성화와 같은 효과를 냅니다.
- drei `<Outlines>`는 실루엣만, `<Edges>`는 1px 고정이라 이 룩에는 부족합니다. 후처리 방식을 유지하세요.

---

## 12. 영상 프리토타입: Blender 파이프라인

Reels용 30초 영상이면 실시간 렌더링일 필요가 없습니다. Blender에서 같은 규칙을 쓰면 레퍼런스에 더 가까운 결과를 빠르게 얻습니다.

| 요소 | Blender 설정 |
|---|---|
| 카메라 | Orthographic, 회전 (60°, 0°, 45°) 근처 |
| 면 톤 | Geometry 노드 Normal → Separate XYZ → Color Ramp(Constant) → Emission |
| 잉크선 | Freestyle 켜기. Line Set을 두 개로 나눔: Silhouette+Border는 굵게(3px), Crease는 얇게(1.5px). 색 `#111008` |
| 그림자 | 바닥에 Shadow Catcher, Sun 라이트 1개, Angle 0°에 가깝게 |
| 색 관리 | View Transform을 Standard로 (Filmic/AgX는 색이 바뀜) |
| 렌더러 | EEVEE로 충분. 프레임당 1초 미만 |

- Blender MCP를 쓰면 Claude에게 키캡 블록과 펭귄 부품 배치를 맡길 수 있습니다. 이 스타일은 형태가 단순해서 결과가 쓸 만합니다.
- 모델과 머티리얼 이름(`cream`, `lime`, `pblack` 등)을 팔레트 키와 같게 지으면, 나중에 glTF로 내보내 웹에서 이름 기준으로 셰이더를 일괄 교체할 수 있습니다.

---

## 13. 자주 걸리는 함정

| 증상 | 원인 | 해결 |
|---|---|---|
| 색이 지정한 hex보다 밝거나 탁함 | 색 관리와 톤매핑이 켜져 있음 | `ColorManagement.enabled = false`, 출력 Linear (R3F는 `flat linear`) |
| 타원체의 색 띠가 기울어짐 | 법선을 `mat3(modelMatrix)`로 변환 | `transpose(inverse(mat3(modelMatrix)))` |
| 캐릭터 얼굴이 반은 흰색, 반은 올리브 | 캐릭터가 카메라 정면(45°)을 봄 | +z 쪽을 보게 하고 `rotation.y`는 0.3 이하로 |
| 눈이 흰자 위 동공처럼 보임 | 얼굴을 별도 메시로 겹쳐 경계에 선이 생김 | 몸통 셰이더에서 SDF로 얼굴 칠하기 |
| 둥근 모서리 곡면에 줄무늬 선 | `curveSegments`가 너무 낮음 | 8 이상 |
| 윗면 테두리 선이 없거나 여러 줄 | 베벨 단계 수 | `bevelSegments: 2` |
| 바닥 경사면에 선이 생김 | 깊이 임계값이 너무 낮음 | 0.14 이상 |
| 그림자 줄무늬(acne) | bias 부족 | `bias -0.0004`, `normalBias 0.012` |
| 그림자 평면이 깜빡임 | 윗면과 z-fighting | 평면을 0.004 띄움 |
| 프레임 저하 | 그림자 맵을 패스마다 다시 그림 | `shadowMap.autoUpdate = false`, 색 패스 직전에만 `needsUpdate` |
| 모바일 발열 | 2배 렌더 + 4096 그림자 | 모바일은 `PR 1.5`, 그림자 2048 |
| 이름표가 흐릿함, 한글 깨짐 | 3D 텍스트 사용 | HTML 오버레이 |

---

## 14. 참고 도구와 에셋

### MCP

| 이름 | 용도 |
|---|---|
| Blender MCP (`uvx blender-mcp`) | Claude가 Blender를 직접 조작해 모델링, 배치 |
| Meshy MCP (`@meshy-ai/meshy-mcp-server`) | 텍스트/이미지 → 3D, 리깅. 이 스타일에는 토폴로지가 지저분해 보조용으로만 |
| threejs-devtools-mcp | 실행 중인 three.js 씬을 에이전트가 검사, 수정. 디버깅용 |

### Claude Code Skills

| 이름 | 내용 |
|---|---|
| OpenAEC Three.js Claude Skill Package | Three.js r160+, R3F, drei, WebGPU 24개 스킬 |
| anthemflynn/ccmp `react-three-fiber` | R3F v9.5+, drei, Rapier, postprocessing |
| freshtechbro/claudedesignskills | 3D/WebGL 스킬 묶음, `blender-web-pipeline` 포함 |

### 참고 프로젝트

| 이름 | 참고할 점 |
|---|---|
| Claw3D | R3F 기반 에이전트 3D 오피스 전체 구조 |
| Pixel Agents | Claude Code JSONL을 관찰해 캐릭터 상태로 바꾸는 방식 |
| agents-home | Zustand로 3D와 UI 상태 공유 |

### 에셋 라이선스 메모

| 출처 | 라이선스 | 오픈소스 레포 포함 |
|---|---|---|
| KayKit, Kenney, 100 Avatars | CC0 | 가능 |
| Quaternius | 상업 사용 가능, 에셋 재배포 금지 | 불가 |
| Mixamo | 상업 사용 가능, 재배포 금지 | 불가 |
| Ready Player Me | 2026-01-31 서비스 종료 | 사용 불가 |

이 데모는 외부 에셋을 쓰지 않으므로 라이선스 제약이 없습니다. 펭귄은 일반적인 펭귄 특징만 참고해 새로 만들었고, 레퍼런스 키링 브랜드의 로고 같은 고유 요소는 넣지 않았습니다.

---

## 다음 단계 제안

1. **프리토타입 (48시간):** 데모 화면을 녹화하거나 Blender로 30초 영상을 렌더링해 사푼사프와 Reels에 올리고, 깃헙 스타나 웨이트리스트 클릭을 측정합니다.
2. **판정:** 기준선을 넘으면 10장의 상태 파일 연결을 붙입니다. 못 넘으면 3D 오피스는 마케팅 소재로만 쓰고 제품에는 넣지 않습니다.
3. **확장:** 에이전트가 늘어나면 소품만 추가하고, 책상은 키캡 블록을 격자로 배치합니다.
