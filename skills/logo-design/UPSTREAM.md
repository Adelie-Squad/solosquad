# UPSTREAM — kaankiziltug/logo-design-skill

| | |
|---|---|
| 저장소 | https://github.com/kaankiziltug/logo-design-skill |
| 고정 커밋 | `e9eaddc07895575253d6663320354a708f53e955` (2026-11-13, "feat: Add clear-filters button to library gallery (#9)") |
| 라이선스 | MIT © 2026 kaankiziltug — `LICENSE`(원문 그대로), `NOTICE` |
| 가져온 날 | 2026-11-25 |

## 가져온 것 (고친 사본)
| 업스트림 | 여기 | 변경 |
|---|---|---|
| `scripts/svglib.py` | 같음 | 라이브러리 경로 상수 삭제, DOCTYPE/ENTITY 가 있는 SVG 거부(엔티티 폭탄 방지) |
| `scripts/svg_audit.py` | 같음 | `stats.json` 대신 앵커 백분위 숫자를 상수로(로고 파일 없음) |
| `scripts/preview_sheet.py` | 같음 | `--refs-industry`(라이브러리) 삭제 → `--refs-generic N`(코드로 만든 일반 도형 12종), 브랜드 색 검증 후 CSS 에 넣음 |
| `scripts/render_png.py` | 같음 | http/file 등 외부 참조가 있는 SVG 렌더 거부, headless Chrome 에 네트워크 차단 플래그(`--host-resolver-rules=MAP * ~NOTFOUND`, 프록시 막음, 백그라운드 서비스 끔) |
| `scripts/presentation_board.py` | 같음 | `brand_color`·`tile_color` 검증 후 CSS 에 넣음 |
| `scripts/export_variants.py` | 같음 | `--icon-bg`·`--icon-fg` 검증 |
| `scripts/concept_sheet.py` | 같음 | 출처 머리말만 |
| `references/` 9개(principles, discovery-brief, mark-types, visual-techniques, typography, svg-construction, testing-checklist, color, critique) | 같음 | 라이브러리·`search_library.py` 언급을 "말로 카테고리 설명" / `--refs-generic` 으로 바꿈 |
| `templates/brand-guidelines-template.md`, `presentation-spec.example.json` | 같음 | 그대로 |
| `skills/logo-design/SKILL.md` | — | 흐름(브리프 → 관습 → 8–12 콘셉트 → 3개 SVG → 테스트 → 체크포인트에서 멈춤 → 키트)만 옮겨 이 폴더의 SKILL.md 를 새로 씀 |

## 뺀 것과 이유
| 업스트림 | 이유 |
|---|---|
| `assets/library/`(실제 로고 SVG 1,432개, catalog/classifications/stats/gallery) | 상표. 업스트림 `TRADEMARKS.md`: MIT 가 적용되지 않음 |
| `scripts/search_library.py`, `scripts/build_catalog.py`, `references/library-guide.md` | 위 라이브러리 전용 |
| `docs/images/`(예시 보드) | 데모 이미지, 24 MB 대부분 |
| `references/process.md`, `presentation-delivery.md`, `identity-system.md`, `redesign.md` | 내용을 SKILL.md 절차로 줄여 옮김(필요하면 고정 커밋에서 읽기) |
| `.claude-plugin/`, `.github/`(traffic 수집 워크플로 포함), `tools/`(패키징·트래픽 통계), `evals/`, `tests/` | 배포·통계용. 제품과 무관 |

## 검토 결과 (스크립트 전부 읽음, 2026-11-25)
- 네트워크 호출 없음(`urllib`·`http`·`socket`·`requests` 없음), 텔레메트리 없음, `shell=True` 없음, `eval`/`exec` 없음.
- `subprocess` 는 `render_png.py` 에만: `rsvg-convert` · `inkscape` · Chrome · `qlmanage` · Windows `taskkill` 을 인자 목록으로 실행.
- 위험했던 곳과 조치: (1) 렌더러가 SVG 안의 원격 이미지/폰트를 받아올 수 있음 → 외부 참조 거부 + Chrome 네트워크 차단.
  (2) 사용자 입력 색이 HTML `style` 에 그대로 들어감 → 색 파싱 실패 시 기본값. (3) `xml.etree` 가 내부 엔티티 확장 → DTD 거부.
- 선택 의존성: `cairosvg`, `Pillow`(Quick Look 투명도) — 없으면 다음 백엔드. 제품 의존성에 추가하지 않는다.

## 업데이트할 때
새 커밋을 받으면 이 표의 파일만 diff 로 비교해 옮기고, 위 검토를 다시 하고, 커밋 SHA 를 SKILL.md · NOTICE · 이 파일 · 테스트(`LOGO_COMMIT`)에서 함께 바꾼다.
