# character/ — 펭귄

SoloSquad 의 모든 에이전트는 같은 펭귄이고, 역할은 소품으로만 구분한다(DESIGN.md `## 에이전트 캐릭터`).
이 폴더는 **2026-11-10 의 펭귄(다시 그린 직후)** 을 기록한다.

| 파일 | 내용 | 만든 것 |
|---|---|---|
| [`spec.md`](spec.md) | 비율 · 부분 · 재질과 색 · 뼈와 소켓 · 2D 아이콘 규격 · 알려진 문제 | 스크립트 · 규격 · DESIGN 에서 옮김 |
| [`palette.json`](palette.json) | 색(키 = 3D 재질 이름, `2d` = `PENGUIN_2D` 키) | `lib.py` · `colors.ts` |
| `turnaround/` | 정면 · 3/4(펭귄 왼쪽) · 옆(왼쪽) · 뒤 · 3/4(펭귄 오른쪽) · 위, 라이트 · 저녁 (800px) | `identity_renders.py turnaround` |
| `renders/` | 얼굴 확대(정면 라이트 · 저녁, 3/4) · 소품 없는 펭귄(1200px) · `props/` 15역할 + 표에 없는 역할(스카프) | `identity_renders.py face · bare · props` |
| `2d/` | `20/ 28/ 40/ 64/` 크기별 아이콘 SVG(`plain` = 소품 없음, 역할 15개, `custom-role` = 스카프) · `mascot-96/240.svg` 전신 | `web/scripts/identity-icons.mjs` |

렌더는 투명 바탕 + 바닥 그림자(shadow catcher), Cycles 64 샘플 · 디노이즈, Standard 뷰 변환이다. 라이트 · 저녁 조명은 사무실 스타일 프레임과 같고(`frames.py`), 저녁에는 앞에서 화면 빛 같은 파란 채움광을 하나 더했다.

다시 만드는 명령은 [`../README.md`](../README.md).
