# ax-agent-web

소규모 비즈니스용 AI 직원 '하루' 웹 인터페이스 프로토타입. 기획은 [PRD.md](./PRD.md).

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # 타입 검사 + 프로덕션 빌드
```

- `/` — 랜딩 (CTA '시작하기')
- `/app` — 서비스 페이지 (사무실 · 대시보드 · 메일 · Task · 스케줄러 · 워크플로우, 하루와 대화), `⌘K` 커맨드 바

모든 데이터는 `src/data/dummy.ts` 의 더미 값이다. 직전 접속 시각을 초기화하려면
브라우저 콘솔에서 `localStorage.removeItem('ax-agent-web.lastVisit')`.

## 실제 AI 로 테스트하기 (선택 — 오픈라우터)

키가 없으면 모든 응답은 더미다. 키를 넣으면 아래 4곳이 실제 모델을 부른다.

| 화면 | 하는 일 |
|---|---|
| 하루와 대화 | 대화 답장 (최근 10개 메시지를 함께 보냄) |
| 워크플로우 › SNS 자동화 › 새 게시물 만들기 | 상품 · 채널에 맞는 게시 문구 |
| 워크플로우 › 상품 소싱 › 📨 중국어 문의 초안 | 공장에 보낼 중국어 견적 문의 + 한국어 번역 |
| 워크플로우 › 재무 관리 › 🤖 분류 제안 | 용도가 불분명한 입출금의 분류와 근거 |

1. https://openrouter.ai → **Keys** 에서 키를 만든다. 무료 모델(`:free` 로 끝나는 ID, 또는 `openrouter/free`)은 충전이 필요 없다.
2. **저장소 루트**(`solosquad/`)의 `.env` 에 넣는다 — SoloSquad 코어와 같은 파일이다. git 에 올라가지 않는다(`.gitignore`).
   ```
   OPENROUTER_API_KEY=sk-or-...
   # OPENROUTER_MODEL=openrouter/free   # 기본값. 특정 무료 모델을 쓰려면 바꾼다
   ```
   `<repo>/.solosquad/.env` 가 있으면 그쪽을 먼저 읽는다(코어 `loadEnv` 와 같은 순서).
3. `npm run dev` — 키는 요청마다 다시 읽으므로 `.env` 를 고친 뒤 다시 띄울 필요는 없다.

키는 개발 서버(`server/llm-proxy.ts`)만 쓰고 브라우저로 나가지 않는다. 화면은 `/api/llm/*` 만 부른다.
`vite build` 결과(정적 배포)에는 이 경로가 없어 더미로 돌아간다. 실패하면(한도 · 키 오류) 더미 응답에 이유를 붙여 보여준다.

무료 한도는 계정 전체 기준 분당 약 20회, 하루 50회(누적 충전 10달러 이상이면 1,000회)다. 생성은 버튼을 눌렀을 때만 일어난다.
