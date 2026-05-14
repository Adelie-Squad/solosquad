# v0.3 PoC Archive

> v0.3 PM 모드 출시 *전* 검증용 integration 스크립트 보관소.
> v0.3·v0.4·v0.5가 출시된 현재는 **참고용**이며 실 운영 안 됨.

## 파일

| 파일 | 검증 대상 |
|---|---|
| `integ-section2-bootstrap.mjs` | v0.3 §2 — PM session 초기화 + agents-builder 동기화 |
| `integ-section3-spawn.mjs` | v0.3 §3 — Task tool spawn + 핸드오프 |
| `integ-section7-rotate.mjs` | v0.3 §7 — session-store rotate + archived |
| `integ-section8-rollback.mjs` | v0.3 §8 — git-snapshot rollback |

## 이력

원래 `experiments/v0.3-poc/`에 있었으며, v0.3 출시 후 `test/` 디렉토리의
단위·E2E 회귀 테스트(현재 269 케이스)로 흡수됐습니다. PoC 스크립트 자체는
*production code path*가 아니라 *시점별 검증*이라 그대로 둘 가치는 낮으나,
v0.3 의사결정 컨텍스트 보존을 위해 `docs/poc/`로 이동 (2026-05-14, v0.6
sprint 시작 전 cleanup).

## 실행 시 주의

이 스크립트는 v0.3.0 시점 API 기준입니다. v0.4·v0.5의 API 변경(`buildRoutes`,
`skill-parser`, AGENT_ROUTES 제거 등)은 반영 안 됨. 그대로 실행하면 import
경로 오류 가능 — 실 회귀가 필요하면 `test/`의 최신 케이스를 사용하세요.
