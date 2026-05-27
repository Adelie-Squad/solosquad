# Engineering Team - 공유 지식

> 소프트웨어 개발, 아키텍처, 데이터 엔지니어링을 담당하는 엔지니어링팀의 공유 지식 베이스

## Team Mission

안정적이고 확장 가능한 기술로 제품 비전을 현실로 구현합니다.

---

## 공유 프레임워크

### 1. 기술 스택 의사결정

#### Frontend
| 요구사항 | 권장 스택 | 비고 |
|----------|----------|------|
| 빠른 MVP | Next.js + Tailwind | 풀스택 가능, Vercel 배포 |
| 인터랙티브 앱 | React + Vite | SPA, 복잡한 상태관리 |
| 정적 사이트 | Astro | 최고 성능, 콘텐츠 중심 |
| 모바일 웹 | Next.js PWA | 설치 가능한 웹앱 |

#### Backend
| 요구사항 | 권장 스택 | 비고 |
|----------|----------|------|
| 빠른 MVP | Supabase | BaaS, 인증/DB/스토리지 포함 |
| 서버리스 API | Vercel Functions / Cloudflare Workers | 스케일 자동, 저비용 |
| 복잡한 비즈니스 로직 | Node.js + Prisma | 타입 안전 ORM |
| 데이터/AI 중심 | Python + FastAPI | ML 생태계 호환 |

#### Database
| 유형 | 권장 | 적합한 경우 |
|------|------|-----------|
| 관계형 | PostgreSQL (Supabase) | 구조화된 데이터, 트랜잭션 |
| NoSQL | MongoDB Atlas | 스키마 유연성 |
| 실시간 | Firebase | 실시간 동기화 필요 |
| 벡터 | Pinecone, Supabase pgvector | AI/검색 |

### 2. 아키텍처 패턴

#### MVP용 심플 아키텍처
```
[Client: Next.js]
      ↓
[API: Vercel Functions]
      ↓
[DB: Supabase PostgreSQL]
      ↓
[Storage: Supabase Storage]
```

#### 스케일업 아키텍처
```
[CDN: Cloudflare]
      ↓
[Client: Next.js on Vercel]
      ↓
[API Gateway]
   ↙     ↘
[Service A] [Service B]
   ↓          ↓
[DB]      [Queue: Redis]
              ↓
         [Workers]
```

### 3. 코드 품질 기준

#### 필수 사항
- TypeScript 사용 (strict mode)
- ESLint + Prettier 설정
- 환경 변수 분리 (.env)
- Git 브랜치 전략 (main/develop/feature)

#### 권장 사항
- 컴포넌트 단위 테스트
- API 통합 테스트
- 에러 모니터링 (Sentry)
- 로깅 표준화

### 4. API 설계 원칙

#### RESTful 컨벤션
```
GET    /api/resources          # 목록 조회
GET    /api/resources/:id      # 단일 조회
POST   /api/resources          # 생성
PUT    /api/resources/:id      # 전체 수정
PATCH  /api/resources/:id      # 부분 수정
DELETE /api/resources/:id      # 삭제
```

#### 응답 형식
```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {
    "page": 1,
    "total": 100
  }
}
```

### 5. 데이터 파이프라인

```
[수집] → [정제] → [변환] → [저장] → [서빙]

수집: API, 크롤링, 이벤트 스트림
정제: 중복 제거, 유효성 검증, 정규화
변환: 집계, 조인, 피처 엔지니어링
저장: 데이터 웨어하우스, 레이크
서빙: API, 대시보드, ML 모델
```

---

## 공유 템플릿

### 기술 명세서 (Tech Spec)
```markdown
# [기능명] 기술 명세서

## 1. 개요
- 목적:
- 범위:

## 2. 아키텍처
- 컴포넌트 다이어그램:
- 데이터 플로우:

## 3. API 명세
| Endpoint | Method | 설명 |
|----------|--------|------|
| | | |

## 4. 데이터 모델
```sql
-- 테이블 정의
```

## 5. 구현 계획
| 태스크 | 담당 | 예상 공수 |
|--------|------|---------|
| | | |

## 6. 테스트 계획
- 단위 테스트:
- 통합 테스트:
- E2E 테스트:

## 7. 배포 계획
- 환경 변수:
- 마이그레이션:
- 롤백 계획:
```

### PR 템플릿
```markdown
## 변경 사항
-

## 관련 이슈
-

## 테스트
- [ ] 로컬 테스트 완료
- [ ] 관련 테스트 추가/수정

## 리뷰 포인트
-
```

---

## 팀 협업 프로토콜

### Strategy 팀과 협업
- **Input 수령**: 기능 명세, 우선순위, 수락 기준
- **Output 제공**: 기술적 제약, 복잡도 평가, 일정 추정

### Experience 팀과 협업
- **Input 수령**: 화면 설계, 인터랙션 명세, 디자인 토큰
- **Output 제공**: 기술적 제약, 구현 가능성, 컴포넌트 제안

### Growth 팀과 협업
- **Input 수령**: 추적 요구사항, 랜딩페이지 요청
- **Output 제공**: 이벤트 스키마, 추적 코드 구현

---

## 의사결정 원칙

### 1. 단순함 우선
```
"가장 단순한 솔루션이 작동하는가?"
과도한 엔지니어링 지양
필요할 때 복잡도 추가
```

### 2. 점진적 개선
```
작동하는 코드 먼저
리팩토링은 필요할 때
"Make it work, make it right, make it fast"
```

### 3. 기술 부채 관리
```
의도적 부채: 기록하고 계획
무의식적 부채: 발견 즉시 개선
부채 상환 시간 확보
```

---

## 공유 용어집

| 용어 | 정의 |
|------|------|
| API | Application Programming Interface |
| REST | Representational State Transfer |
| GraphQL | 쿼리 언어 기반 API |
| ORM | Object-Relational Mapping |
| CI/CD | Continuous Integration/Deployment |
| BaaS | Backend as a Service |
| Serverless | 서버 관리 없는 컴퓨팅 |
| Edge Computing | 사용자 가까이 실행 |
| Technical Debt | 기술 부채 |
| Monorepo | 단일 저장소 다중 프로젝트 |
| Microservice | 소규모 독립 서비스 |
| ETL | Extract, Transform, Load |
