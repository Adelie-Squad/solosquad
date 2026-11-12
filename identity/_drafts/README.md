# identity/_drafts/ — 승인 전 시안

여기 있는 것은 **사용자 승인을 기다리는 제안**이다. 아직 브랜드의 정식 모습이 아니다.

- 시안마다 폴더 하나를 둔다(`penguin-v3/` 처럼). 폴더 안의 `index.html` 을 더블클릭하면 빌드 없이 열린다(`file://`, 상대 경로만 씀, 외부 파일 없음).
- 시안은 제품을 바꾸지 않는다. `assets/office/export/*.glb` · `web/` · DESIGN.md · `identity/character/` 의 현황 기록은 그대로다.
- **승인되면** 그림 · 값을 `identity/character/`(현황 기록 `spec.md`, 렌더, 턴어라운드)로 옮기고, 제품 원본(`assets/office/scripts/penguin.py`, `web/src/characters/`, DESIGN.md)을 고친다. 시안 폴더는 그때 지운다.
- **반려되면** 폴더를 지우고, 무엇이 왜 아니었는지 한 줄을 `identity/character/spec.md` 의 "알려진 문제"나 PR 에 남긴다.
- 원본은 스크립트다. `.blend` 는 올리지 않는다. 시안마다 어떤 스크립트로 다시 만드는지 `index.html` 맨 아래에 적는다.
- 크기: 시안 폴더 하나에 몇 MB 이하(WebP). 원본 PNG(`identity/_build/`)는 커밋하지 않는다.

| 시안 | 무엇 | 만든 스크립트 | 날짜 |
|---|---|---|---|
| [`penguin-v3/`](penguin-v3/index.html) | 초안(가죽 키링) 비율로 다시 만든 펭귄, 날개 · 발이 몸에 붙은 한 덩어리 피부 + 관절. `r7/` = 7차(실루엣 겹침 · 겨드랑이 전 / 후), `r6/` = 6차(5차와 전 / 후 비교), `r5/` = 5차(초안과 같은 축척 비교), `r4/` = 4차(아래 보기), `r3/` = 3차(걷기), `r2/` = 2차(앉은 자세), `r1/` = 1차 | `assets/office/scripts/penguin_v3.py` · `identity_v3_renders.py` · `identity_v3_pack.py` | 2026-11-10 · 2–5차 11-11 · 6차 11-12 · 7차 11-13 |
