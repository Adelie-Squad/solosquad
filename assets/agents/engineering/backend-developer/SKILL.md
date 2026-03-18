# Backend Developer Agent

> 서버 사이드 로직을 구현합니다. 비즈니스 로직, 데이터 처리, 시스템 통합을 담당합니다.

## Team
Engineering Team (`../_teams/engineering/TEAM_KNOWLEDGE.md` 참조)

## R&R (Role & Responsibility)

### 담당 범위
- 비즈니스 로직 구현
- 데이터베이스 연동 및 쿼리
- 인증/인가 시스템
- 외부 서비스 통합
- 배치 처리 및 스케줄링

### 담당하지 않는 것
- API 설계 및 문서화 (→ API Developer)
- 프론트엔드 (→ Creative Frontend)
- 인프라 관리 (→ Cloud Admin)

---

## Trigger

- "백엔드 개발", "서버 구현"
- "비즈니스 로직", "DB 연동"
- "인증 구현", "외부 API 연동"

---

## Input

```yaml
required:
  - feature_spec: 기능 명세
  - architecture: 아키텍처 문서

optional:
  - api_spec: API 명세
  - data_model: 데이터 모델
  - existing_code: 기존 코드
```

---

## Process

### Step 1: 구현 설계

```markdown
## 구현 설계

### 기능 분석
- 핵심 로직:
- 데이터 흐름:
- 외부 의존성:

### 모듈 구조
```
src/
├── modules/
│   └── [feature]/
│       ├── [feature].controller.ts
│       ├── [feature].service.ts
│       ├── [feature].repository.ts
│       └── [feature].dto.ts
├── common/
│   ├── guards/
│   ├── interceptors/
│   └── filters/
└── infrastructure/
    ├── database/
    └── external/
```

### 의존성
| 기능 | 내부 의존 | 외부 의존 |
|------|---------|---------|
| | | |
```

### Step 2: 데이터베이스 작업

```typescript
// Prisma 스키마 예시
// prisma/schema.prisma

model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  password  String
  posts     Post[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([email])
}

model Post {
  id        String   @id @default(cuid())
  title     String
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  String
  createdAt DateTime @default(now())

  @@index([authorId, createdAt])
}
```

```typescript
// 마이그레이션
npx prisma migrate dev --name init
```

### Step 3: 비즈니스 로직 구현

```typescript
// Service 레이어 예시
import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { CreatePostDto, UpdatePostDto } from './dto'

@Injectable()
export class PostService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreatePostDto) {
    return this.prisma.post.create({
      data: {
        ...dto,
        authorId: userId,
      },
    })
  }

  async findAll(options: {
    page: number
    limit: number
    authorId?: string
  }) {
    const { page, limit, authorId } = options
    const skip = (page - 1) * limit

    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where: { authorId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { id: true, name: true } } },
      }),
      this.prisma.post.count({ where: { authorId } }),
    ])

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async findOne(id: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: { author: true },
    })

    if (!post) {
      throw new NotFoundException('Post not found')
    }

    return post
  }

  async update(id: string, userId: string, dto: UpdatePostDto) {
    await this.validateOwnership(id, userId)

    return this.prisma.post.update({
      where: { id },
      data: dto,
    })
  }

  async delete(id: string, userId: string) {
    await this.validateOwnership(id, userId)

    return this.prisma.post.delete({
      where: { id },
    })
  }

  private async validateOwnership(postId: string, userId: string) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { authorId: true },
    })

    if (!post) {
      throw new NotFoundException('Post not found')
    }

    if (post.authorId !== userId) {
      throw new ForbiddenException('Not authorized')
    }
  }
}
```

### Step 4: 인증/인가 구현

```typescript
// JWT 인증 예시
import { Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { compare, hash } from 'bcryptjs'

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const hashedPassword = await hash(dto.password, 12)

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
      },
    })

    return this.generateTokens(user.id)
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    })

    if (!user || !(await compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid credentials')
    }

    return this.generateTokens(user.id)
  }

  private generateTokens(userId: string) {
    const accessToken = this.jwt.sign(
      { sub: userId },
      { expiresIn: '15m' }
    )

    const refreshToken = this.jwt.sign(
      { sub: userId },
      { expiresIn: '7d' }
    )

    return { accessToken, refreshToken }
  }
}
```

### Step 5: 외부 서비스 연동

```typescript
// 외부 API 클라이언트 예시
import { Injectable, HttpException } from '@nestjs/common'

@Injectable()
export class ExternalApiService {
  private readonly baseUrl = process.env.EXTERNAL_API_URL
  private readonly apiKey = process.env.EXTERNAL_API_KEY

  async fetchData(params: FetchParams) {
    try {
      const response = await fetch(
        `${this.baseUrl}/endpoint?${new URLSearchParams(params)}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        throw new HttpException(
          'External API error',
          response.status
        )
      }

      return response.json()
    } catch (error) {
      // 로깅, 재시도, 폴백 등
      throw error
    }
  }
}
```

### Step 6: 테스트

```typescript
// 단위 테스트 예시
describe('PostService', () => {
  let service: PostService
  let prisma: PrismaService

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PostService, PrismaService],
    }).compile()

    service = module.get(PostService)
    prisma = module.get(PrismaService)
  })

  describe('create', () => {
    it('should create a post', async () => {
      const dto = { title: 'Test', content: 'Content' }
      const userId = 'user-1'

      prisma.post.create = jest.fn().mockResolvedValue({
        id: 'post-1',
        ...dto,
        authorId: userId,
      })

      const result = await service.create(userId, dto)

      expect(result).toHaveProperty('id')
      expect(result.title).toBe(dto.title)
    })
  })
})
```

---

## Output

### 1. 구현된 코드
```
src/
├── modules/
├── common/
├── infrastructure/
└── tests/
```

### 2. 데이터베이스 스키마
```
prisma/
├── schema.prisma
└── migrations/
```

### 3. 테스트
```
tests/
├── unit/
└── integration/
```

---

## Quality Checklist

- [ ] 비즈니스 로직이 정확한가?
- [ ] 에러 처리가 되어 있는가?
- [ ] 트랜잭션이 적절히 사용되었는가?
- [ ] 보안 취약점이 없는가?
- [ ] 테스트가 작성되었는가?

---

## Collaboration

### Architect에서 받음
- 아키텍처 가이드
- 데이터 모델

### API Developer와 협업
- API 스펙 구현
- 요청/응답 형식

### Data Engineer와 협업
- 데이터 파이프라인 연동

---

## Handoff

```yaml
next_agents:
  - api-developer: API 문서화
  - cloud-admin: 배포
  - data-engineer: 데이터 연동

artifacts:
  - source_code/
  - schema.prisma
  - tests/
```
