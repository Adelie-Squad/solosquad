# Strategy Team - 공유 지식

> 제품 전략, 기획, 분석을 담당하는 전략팀의 공유 지식 베이스

## Team Mission

비즈니스 목표를 달성 가능한 제품 계획으로 변환하고, 데이터 기반 의사결정을 지원합니다.

---

## 공유 프레임워크

### 1. 가설 수립 프레임워크

모든 기획은 검증 가능한 가설에서 시작합니다.

```markdown
## 가설 템플릿

### 문제 가설 (Problem Hypothesis)
"[타겟 사용자]는 [상황]에서 [문제]를 겪고 있다."

### 솔루션 가설 (Solution Hypothesis)
"[기능/서비스]를 제공하면 [문제]가 해결될 것이다."

### 비즈니스 가설 (Business Hypothesis)
"[타겟 사용자]는 이 솔루션에 [가격/행동]을 지불할 것이다."

### 검증 방법
- 지표:
- 목표 기준:
- 측정 기간:
```

### 2. 우선순위 결정 프레임워크

#### ICE Score
```
Impact (1-10) × Confidence (1-10) × Ease (1-10) = Score
```

#### RICE Score
```
(Reach × Impact × Confidence) / Effort = Score
```

#### MoSCoW
- **Must Have**: 없으면 출시 불가
- **Should Have**: 중요하지만 대안 존재
- **Could Have**: 있으면 좋음
- **Won't Have**: 이번에는 안함

### 3. 사용자 세그먼트 정의

```markdown
## 세그먼트 템플릿

### 세그먼트명: [이름]

#### Demographics
- 연령대:
- 직업/역할:
- 수입 수준:

#### Psychographics
- 목표:
- 고통점:
- 행동 패턴:

#### Jobs to be Done
- Functional Job:
- Emotional Job:
- Social Job:
```

### 4. 지표 프레임워크

#### North Star Metric
- 정의: 핵심 가치 전달을 측정하는 단일 지표
- 조건: 비즈니스 성과와 상관관계, 팀이 영향 가능, 장기적 가치 반영

#### AARRR Funnel
| 단계 | 의미 | 예시 지표 |
|------|------|----------|
| Acquisition | 사용자 획득 | 신규 방문자, 가입률 |
| Activation | 가치 경험 | Aha moment 도달률 |
| Retention | 재사용 | DAU/MAU, 재방문율 |
| Revenue | 수익화 | ARPU, 결제 전환율 |
| Referral | 추천 | NPS, 바이럴 계수 |

---

## 공유 템플릿

### PRD 구조
```markdown
# [기능명] PRD

## 1. Overview
### 1.1 문제 정의
### 1.2 목표
### 1.3 성공 지표

## 2. 사용자
### 2.1 타겟 세그먼트
### 2.2 사용자 여정

## 3. 솔루션
### 3.1 핵심 기능
### 3.2 범위 (In/Out)
### 3.3 요구사항

## 4. 계획
### 4.1 마일스톤
### 4.2 리스크
### 4.3 의존성
```

### 사용자 스토리 템플릿
```
As a [사용자 유형],
I want to [목표/행동],
So that [기대 결과/가치].

Acceptance Criteria:
- Given [상황], When [행동], Then [결과]
```

---

## 팀 협업 프로토콜

### Experience 팀과 협업
- **Input 제공**: 타겟 사용자 정의, 핵심 문제, 검증할 가설
- **Output 수령**: 사용자 인사이트, 페르소나, 니즈 맵

### Growth 팀과 협업
- **Input 제공**: 제품 포지셔닝, 핵심 가치 제안, 타겟 세그먼트
- **Output 수령**: 시장 반응, 획득 채널 효율, 사용자 피드백

### Engineering 팀과 협업
- **Input 제공**: 기능 명세, 우선순위, 수락 기준
- **Output 수령**: 기술적 제약, 구현 복잡도, 일정 추정

---

## 의사결정 원칙

### 1. 데이터 기반 결정
```
직관 < 정성 데이터 < 정량 데이터
단, 데이터가 없을 때는 빠른 가설 검증 우선
```

### 2. 고객 중심 사고
```
"이 결정이 고객에게 어떤 가치를 주는가?"
"고객이 이것을 원한다는 증거가 있는가?"
```

### 3. 반복적 개선
```
완벽한 계획 < 실행 + 학습 + 개선
80% 확신이면 실행, 검증 후 조정
```

---

## 공유 용어집

| 용어 | 정의 |
|------|------|
| PMF (Product-Market Fit) | 제품이 시장의 니즈를 충족하는 상태 |
| MVP (Minimum Viable Product) | 가설 검증에 필요한 최소 기능 제품 |
| MLP (Minimum Lovable Product) | 사용자가 좋아할 수 있는 최소 제품 |
| North Star | 핵심 가치 전달을 측정하는 단일 지표 |
| Aha Moment | 사용자가 제품 가치를 인지하는 순간 |
| Retention Curve | 시간에 따른 사용자 유지율 곡선 |
| Cohort | 특정 시점에 동일 경험을 한 사용자 그룹 |
