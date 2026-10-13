# ax-agent-web

소규모 비즈니스용 AI 직원 '하루' 웹 인터페이스 PoC. 기획은 [PRD.md](./PRD.md).

```bash
npm install
npm run dev        # http://localhost:5180
npm run build      # 타입 검사 + 프로덕션 빌드
```

- `/` — 랜딩 (CTA '시작하기')
- `/app` — 서비스 페이지 (홈 · 실시간 작업 · 메일 · Task · 스케줄러), `⌘K` 커맨드 바

모든 데이터는 `src/data/dummy.ts` 의 더미 값이다. 직전 접속 시각을 초기화하려면
브라우저 콘솔에서 `localStorage.removeItem('ax-agent-web.lastVisit')`.
