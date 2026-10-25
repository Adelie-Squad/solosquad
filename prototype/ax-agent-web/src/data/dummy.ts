// 더미 데이터 — 실제 백엔드/메일/스케줄러 연동 없이 화면을 채우기 위한 고정 값.
// 시나리오: 동네 베이커리 '모모 베이커리' 사장님이 AI 직원 '하루'를 쓰는 상황.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const later = (ms: number) => new Date(Date.now() + ms).toISOString();

export const AGENT_NAME = '하루';

export interface Space {
  id: string;
  name: string;
  emoji: string;
  /** Arc 의 스페이스 색상처럼 창 전체 배경을 칠하는 그라디언트 */
  gradient: string;
  accent: string;
}

// ── 업무 카테고리 (= 부서 에이전트) ─────────────────────────────────
// 하루(마스터 에이전트)가 카테고리별 하위 에이전트에게 일을 나눠 맡긴다.
// 팀원 권한도 이 단위로 연다.

export type CategoryId = 'finance' | 'marketing' | 'cs' | 'sourcing' | 'store';

export interface Category {
  id: CategoryId;
  label: string;
  icon: string;
}

export const categories: Category[] = [
  { id: 'finance', label: '재무', icon: '💰' },
  { id: 'marketing', label: '마케팅', icon: '📣' },
  { id: 'cs', label: '고객 응대', icon: '💬' },
  { id: 'sourcing', label: '재료 · 발주', icon: '📦' },
  { id: 'store', label: '매장 운영', icon: '🏪' },
];

export const categoryById = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<CategoryId, Category>;

/** 사업장은 하나로 고정 — 배경색 전환 기능은 두지 않는다 */
export const space: Space = {
  id: 'momo',
  name: '모모 베이커리',
  emoji: '🥐',
  gradient: 'linear-gradient(135deg, #b9a7ff 0%, #f6b8d6 55%, #ffd9b8 100%)',
  accent: '#6d4aff',
};

// ── 지난 접속 이후 보고 ───────────────────────────────────────────

export type ReportKind = 'done' | 'attention' | 'insight';

export interface ReportItem {
  id: string;
  kind: ReportKind;
  title: string;
  detail: string;
}

export const reportSinceLastVisit: ReportItem[] = [
  {
    id: 'r1',
    kind: 'done',
    title: '주문 문의 메일 12건 답장 초안 작성',
    detail: '9건은 자동 발송 기준(배송 일정 안내)에 맞아 보냈고, 3건은 검토 대기 중이에요.',
  },
  {
    id: 'r2',
    kind: 'done',
    title: '네이버 리뷰 7건에 답글 등록',
    detail: '별점 3점 이하 1건은 사장님 확인 후 등록하도록 보류했어요.',
  },
  {
    id: 'r3',
    kind: 'attention',
    title: '버터 재고가 이틀 치만 남았어요',
    detail: '평소 주문처(서울유업) 기준 발주서 초안을 만들어 두었어요. 승인만 하시면 돼요.',
  },
  {
    id: 'r4',
    kind: 'insight',
    title: '지난주 대비 소금빵 매출 +18%',
    detail: '오후 3~5시 주문이 몰렸어요. 해당 시간대 2차 굽기를 제안드려요.',
  },
];

export interface SuggestedPrompt {
  id: string;
  icon: string;
  text: string;
}

export const suggestedPrompts: SuggestedPrompt[] = [
  { id: 'p1', icon: '🧾', text: '버터 발주서 초안 보여줘' },
  { id: 'p2', icon: '✉️', text: '검토 대기 중인 답장 3건 같이 보자' },
  { id: 'p3', icon: '📈', text: '이번 주 매출 요약해줘' },
  { id: 'p4', icon: '📣', text: '주말 신메뉴 인스타 게시물 초안 써줘' },
  { id: 'p5', icon: '📅', text: '오늘 예약 주문 알려줘' },
  { id: 'p6', icon: '💬', text: '불만 리뷰 모아서 정리해줘' },
  { id: 'p7', icon: '🧮', text: '부가세 신고 준비 어디까지 됐어?' },
  { id: 'p8', icon: '🙋', text: '이번 달 단골 손님 분석해줘' },
];

/** 홈 대화창의 더미 응답 — 키워드 매칭, 없으면 기본 응답 */
export const cannedReplies: { keywords: string[]; reply: string }[] = [
  {
    keywords: ['발주', '버터', '재고'],
    reply:
      '서울유업 발주서 초안이에요.\n• 무염버터 10kg × 2박스\n• 납품 희망일: 모레 오전\n• 예상 금액: 384,000원\n승인하시면 거래처 메일로 바로 보낼게요.',
  },
  {
    keywords: ['답장', '검토', '메일'],
    reply:
      '검토 대기 3건이에요.\n1) 단체 주문(케이크 30개) 견적 문의\n2) 알레르기 성분 문의\n3) 배송 지연 항의\n세 건 모두 초안을 써 두었어요. 메일 탭에서 하나씩 확인하실 수 있어요.',
  },
  {
    keywords: ['매출', '요약'],
    reply:
      '이번 주 매출은 4,820,000원으로 지난주보다 9% 늘었어요. 소금빵과 크루아상이 전체의 41%를 차지했고, 화요일이 가장 조용했어요.',
  },
  {
    keywords: ['인스타', '게시물', '신메뉴'],
    reply:
      '초안이에요 ✍️\n"이번 주말만 만나는 🍓딸기 크림 크루아상! 아침 10시, 딱 40개만 구워요. 늦으면 없어요 🥐"\n사진은 어제 찍어두신 시안 2번이 잘 어울려요.',
  },
  {
    keywords: ['예약'],
    reply:
      '오늘 예약 주문은 3건이에요.\n• 11:00 생크림 케이크 1호 — 김민지님 (픽업)\n• 14:30 크루아상 12개 — 카페 소요 (배송)\n• 17:00 조각 케이크 30개 — 김지현님 단체 주문 (견적 승인 대기)',
  },
  {
    keywords: ['불만', '리뷰'],
    reply:
      '최근 30일 리뷰 중 불만은 5건이에요.\n• 배송 지연 2건\n• 크림이 너무 달다 2건\n• 포장 파손 1건\n배송 지연은 화요일 택배 마감 시간과 겹쳐요. 마감을 1시간 앞당기는 걸 제안드려요.',
  },
  {
    keywords: ['부가세'],
    reply:
      '부가세 신고 자료는 70% 정리됐어요. 매출 자료는 끝났고, 카드 매입 영수증 14건을 분류하고 있어요. 신고 마감 일주일 전까지 마무리할게요.',
  },
  {
    keywords: ['단골'],
    reply:
      '이번 달 3번 이상 방문한 단골은 42명이에요. 주로 평일 오전에 소금빵을 사 가세요. 단골 대상 "오전 10시 전 방문 시 아메리카노 할인" 쿠폰을 제안드려요.',
  },
];

export const fallbackReply =
  '알겠어요! 작업 목록에 추가해 두고, 진행 상황은 왼쪽 "실시간 작업"에서 보실 수 있게 할게요.';

// ── 실시간 작업 ──────────────────────────────────────────────────

export interface JobTemplate {
  title: string;
  icon: string;
  category: CategoryId;
  steps: string[];
  /** 진행 틱마다 쓰는 토큰 — 이미지 생성 · 최저가 탐색처럼 반복 시도가 많은 일일수록 크다 */
  tokensPerTick: number;
}

/** 실시간 작업 시뮬레이터가 순환시키는 작업 풀 */
export const jobPool: JobTemplate[] = [
  {
    title: '주문 문의 메일 분류',
    icon: '✉️',
    category: 'cs',
    steps: ['받은편지함 확인', '문의 유형 분류', '답장 초안 작성', '자동 발송 기준 검사'],
    tokensPerTick: 900,
  },
  {
    title: '네이버 리뷰 답글',
    icon: '💬',
    category: 'cs',
    steps: ['새 리뷰 수집', '감정 분석', '답글 초안 작성', '등록'],
    tokensPerTick: 700,
  },
  {
    title: '일일 매출 정리',
    icon: '📊',
    category: 'finance',
    steps: ['POS 데이터 가져오기', '스마트스토어 주문 합산', '입출금 문자 대조', '결산 시트 작성'],
    tokensPerTick: 500,
  },
  {
    title: '버터 최저가 비교',
    icon: '📦',
    category: 'sourcing',
    steps: ['거래처 6곳 단가 수집', '배송비 포함 비교', '발주서 초안 작성'],
    tokensPerTick: 1600,
  },
  {
    title: '인스타그램 게시물 준비',
    icon: '📣',
    category: 'marketing',
    steps: ['신메뉴 정보 정리', '문구 초안 3개 작성', '이미지 시안 생성', '해시태그 선정'],
    tokensPerTick: 2600,
  },
];

// ── 메일 연동 ────────────────────────────────────────────────────

export interface MailAccount {
  id: string;
  provider: 'Gmail' | 'Naver' | 'Outlook';
  address: string;
  connected: boolean;
  syncedAt?: string;
}

export const mailAccounts: MailAccount[] = [
  { id: 'a1', provider: 'Gmail', address: 'momo.bakery@gmail.com', connected: true, syncedAt: ago(3 * MIN) },
  { id: 'a2', provider: 'Naver', address: 'momobakery@naver.com', connected: true, syncedAt: ago(11 * MIN) },
  { id: 'a3', provider: 'Outlook', address: '연결되지 않음', connected: false },
];

export type MailLabel = '주문문의' | '단체주문' | '거래처' | '세금계산서' | '광고' | '클레임';

export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  preview: string;
  receivedAt: string;
  label: MailLabel;
  aiAction: string;
  needsReview: boolean;
  unread: boolean;
}

export const mailMessages: MailMessage[] = [
  {
    id: 'm1',
    from: '김지현',
    subject: '케이크 30개 단체 주문 가능할까요?',
    preview: '다음 주 금요일 회사 행사용으로 조각 케이크 30개 주문하고 싶은데요…',
    receivedAt: ago(25 * MIN),
    label: '단체주문',
    aiAction: '견적 포함 답장 초안 작성됨',
    needsReview: true,
    unread: true,
  },
  {
    id: 'm2',
    from: '박서준',
    subject: '견과류 알레르기 관련 문의',
    preview: '아이가 견과류 알레르기가 있는데 소금빵에 견과류가 들어가나요?',
    receivedAt: ago(1.5 * HOUR),
    label: '주문문의',
    aiAction: '성분표 첨부 답장 초안 작성됨',
    needsReview: true,
    unread: true,
  },
  {
    id: 'm3',
    from: '이도윤',
    subject: '배송이 너무 늦어요',
    preview: '어제 도착 예정이었는데 아직 안 왔습니다. 확인 부탁드려요.',
    receivedAt: ago(3 * HOUR),
    label: '클레임',
    aiAction: '송장 조회 후 사과 답장 초안 작성됨',
    needsReview: true,
    unread: false,
  },
  {
    id: 'm4',
    from: '서울유업',
    subject: '10월 거래명세서 송부',
    preview: '안녕하세요, 서울유업입니다. 10월 거래명세서를 첨부드립니다.',
    receivedAt: ago(5 * HOUR),
    label: '거래처',
    aiAction: '장부에 기록함',
    needsReview: false,
    unread: false,
  },
  {
    id: 'm5',
    from: '홈택스',
    subject: '[국세청] 전자세금계산서 발급 안내',
    preview: '모모 베이커리 귀하, 전자세금계산서가 발급되었습니다.',
    receivedAt: ago(9 * HOUR),
    label: '세금계산서',
    aiAction: '세무 폴더에 보관함',
    needsReview: false,
    unread: false,
  },
  {
    id: 'm6',
    from: '최유나',
    subject: '크루아상 택배 주문 문의',
    preview: '지방인데 택배로도 받을 수 있나요? 몇 개부터 가능한지 궁금해요.',
    receivedAt: ago(14 * HOUR),
    label: '주문문의',
    aiAction: '배송 안내 답장 자동 발송함',
    needsReview: false,
    unread: false,
  },
  {
    id: 'm7',
    from: '배민사장님광장',
    subject: '가을 프로모션 참여 안내',
    preview: '사장님, 가을 시즌 할인 프로모션에 참여해 보세요!',
    receivedAt: ago(1 * DAY),
    label: '광고',
    aiAction: '보관함으로 이동',
    needsReview: false,
    unread: false,
  },
];

// ── Task 목록 ────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  source: '메일' | '스케줄러' | '대화' | '리뷰';
  assignee: 'AI' | '사장님';
  category: CategoryId;
  status: TaskStatus;
  due: string;
  priority: 'high' | 'normal' | 'low';
}

export const tasks: Task[] = [
  { id: 't1', title: '버터 발주서 승인', source: '대화', assignee: '사장님', category: 'sourcing', status: 'todo', due: later(5 * HOUR), priority: 'high' },
  { id: 't2', title: '단체 주문 견적 답장 검토', source: '메일', assignee: '사장님', category: 'cs', status: 'todo', due: later(3 * HOUR), priority: 'high' },
  { id: 't3', title: '별점 2점 리뷰 답글 확인', source: '리뷰', assignee: '사장님', category: 'cs', status: 'todo', due: later(1 * DAY), priority: 'normal' },
  { id: 't4', title: '주문 문의 메일 분류', source: '스케줄러', assignee: 'AI', category: 'cs', status: 'in_progress', due: later(20 * MIN), priority: 'normal' },
  { id: 't5', title: '주말 신메뉴 인스타 게시물 준비', source: '대화', assignee: 'AI', category: 'marketing', status: 'in_progress', due: later(2 * DAY), priority: 'normal' },
  { id: 't6', title: '10월 거래명세서 장부 기록', source: '메일', assignee: 'AI', category: 'finance', status: 'done', due: ago(4 * HOUR), priority: 'low' },
  { id: 't7', title: '네이버 리뷰 7건 답글 등록', source: '스케줄러', assignee: 'AI', category: 'cs', status: 'done', due: ago(8 * HOUR), priority: 'normal' },
  { id: 't8', title: '부가세 신고 자료 정리', source: '대화', assignee: 'AI', category: 'finance', status: 'todo', due: later(6 * DAY), priority: 'normal' },
  { id: 't9', title: '확인 안 된 입금 1건 용도 알려주기', source: '대화', assignee: '사장님', category: 'finance', status: 'todo', due: later(1 * DAY), priority: 'normal' },
  { id: 't10', title: '오후 3시 2차 굽기 일정 반영', source: '대화', assignee: 'AI', category: 'store', status: 'todo', due: later(2 * DAY), priority: 'low' },
];

// ── 자동화 스케줄러 ──────────────────────────────────────────────

export interface Schedule {
  id: string;
  name: string;
  description: string;
  category: CategoryId;
  cadence: string;
  nextRun: string;
  enabled: boolean;
  /** 새로 만든 자동화는 실행 기록이 없다 */
  lastResult: { ok: boolean; summary: string; at: string } | null;
}

export const schedules: Schedule[] = [
  {
    id: 's1',
    name: '아침 브리핑',
    description: '전날 매출 · 오늘 예약 주문 · 재고 경고를 정리해 보고',
    category: 'store',
    cadence: '매일 오전 7:00',
    nextRun: later(14 * HOUR),
    enabled: true,
    lastResult: { ok: true, summary: '보고 1건 생성', at: ago(10 * HOUR) },
  },
  {
    id: 's2',
    name: '주문 문의 메일 처리',
    description: '새 메일을 분류하고 기준에 맞는 문의는 자동 답장',
    category: 'cs',
    cadence: '30분마다',
    nextRun: later(12 * MIN),
    enabled: true,
    lastResult: { ok: true, summary: '4건 처리 · 1건 검토 요청', at: ago(18 * MIN) },
  },
  {
    id: 's3',
    name: '리뷰 답글',
    description: '네이버 · 카카오맵 새 리뷰에 답글 작성 (3점 이하 보류)',
    category: 'cs',
    cadence: '매일 오후 9:00',
    nextRun: later(5 * HOUR),
    enabled: true,
    lastResult: { ok: true, summary: '7건 등록 · 1건 보류', at: ago(19 * HOUR) },
  },
  {
    id: 's4',
    name: '주간 매출 리포트',
    description: '품목별 · 시간대별 매출과 다음 주 제안',
    category: 'finance',
    cadence: '매주 월요일 오전 8:00',
    nextRun: later(4 * DAY),
    enabled: true,
    lastResult: { ok: true, summary: '리포트 1건 생성', at: ago(3 * DAY) },
  },
  {
    id: 's5',
    name: '재고 발주 점검',
    description: '재료 소진 예측 후 발주서 초안 작성',
    category: 'sourcing',
    cadence: '매주 화 · 금 오후 2:00',
    nextRun: later(1 * DAY),
    enabled: true,
    lastResult: { ok: false, summary: 'POS 연결 시간 초과 — 재시도 예정', at: ago(2 * DAY) },
  },
  {
    id: 's6',
    name: '인스타그램 예약 게시',
    description: '승인된 게시물 초안을 지정 시각에 게시',
    category: 'marketing',
    cadence: '매주 토요일 오전 9:30',
    nextRun: later(4 * DAY + 2 * HOUR),
    enabled: false,
    lastResult: { ok: true, summary: '게시물 1건 게시', at: ago(6 * DAY) },
  },
];

/** '+ 새 자동화' 폼의 주기 선택지 — 다음 실행까지 남은 시간은 더미 값 */
export const cadenceOptions: { label: string; nextRunInMs: number }[] = [
  { label: '매일 오전 9:00', nextRunInMs: 17 * HOUR },
  { label: '매일 오후 6:00', nextRunInMs: 2 * HOUR },
  { label: '매주 월요일 오전 8:00', nextRunInMs: 4 * DAY },
  { label: '1시간마다', nextRunInMs: 40 * MIN },
];


// ── 설정 (로컬 상태만, 저장하지 않음) ─────────────────────────────

export interface AgentSettings {
  ownerTitle: string;
  tone: 'friendly' | 'formal';
  autoSendShippingReplies: boolean;
  holdLowRatingReviews: boolean;
  alwaysApproveOrders: boolean;
  briefingTime: string;
}

export const defaultSettings: AgentSettings = {
  ownerTitle: '사장님',
  tone: 'friendly',
  autoSendShippingReplies: true,
  holdLowRatingReviews: true,
  alwaysApproveOrders: true,
  briefingTime: '07:00',
};

// ── 팀원 · 권한 ──────────────────────────────────────────────────
// 마스터(사장님)만 하루에게 모든 일을 지시할 수 있다. 팀원은 열어 준 부서 에이전트의 일만 보고 맡긴다.

export interface Member {
  id: string;
  name: string;
  role: string;
  emoji: string;
  master: boolean;
  categories: CategoryId[];
}

export const defaultMembers: Member[] = [
  { id: 'owner', name: '사장님', role: '대표', emoji: '👑', master: true, categories: categories.map((c) => c.id) },
  { id: 'wangli', name: '왕리', role: '재료 소싱 담당', emoji: '🧑‍💼', master: false, categories: ['sourcing', 'finance'] },
  { id: 'haneul', name: '김하늘', role: '매장 · SNS 담당', emoji: '🧑‍🍳', master: false, categories: ['marketing', 'cs', 'store'] },
];

// ── 토큰 사용량 ──────────────────────────────────────────────────

/** 월 예산과 환산 단가 — 모델 혼합 평균을 가정한 더미 값 */
export const tokenBudget = { monthlyTokens: 6_000_000, krwPerMillion: 14_000 };

/** 이번 달(접속 전까지) 카테고리별 누적 — 실시간 작업 토큰이 여기에 더해진다 */
export const tokenUsageByCategory: Record<CategoryId, number> = {
  marketing: 1_680_000,
  cs: 920_000,
  sourcing: 610_000,
  finance: 410_000,
  store: 160_000,
};

/** 최근 14일 일별 사용량 (오래된 날 → 오늘) */
export const dailyTokens: { date: string; tokens: number }[] = [
  182_000, 164_000, 240_000, 205_000, 158_000, 96_000, 88_000, 214_000, 236_000, 198_000, 312_000, 267_000,
  141_000, 74_000,
].map((tokens, i, all) => ({ date: ago((all.length - 1 - i) * DAY), tokens }));

/** 이번 달 토큰을 많이 쓴 작업 */
export const tokenTopJobs: { title: string; category: CategoryId; tokens: number; note: string }[] = [
  { title: '주말 신메뉴 인스타 게시물', category: 'marketing', tokens: 420_000, note: '이미지 시안 6장 생성' },
  { title: '버터 · 생크림 최저가 비교', category: 'sourcing', tokens: 268_000, note: '거래처 6곳 × 3회 재시도' },
  { title: '9월 결산 시트 작성', category: 'finance', tokens: 96_000, note: '엑셀 3개 시트 집계' },
  { title: '주문 문의 메일 답장', category: 'cs', tokens: 71_000, note: '메일 48건' },
];

// ── 재무 ────────────────────────────────────────────────────────

export interface MonthlyStatement {
  month: string;
  revenue: number;
  ingredients: number;
  payroll: number;
  rent: number;
  other: number;
  /** 진행 중인 달 — 자동 기록으로 채워지는 중 */
  partial?: boolean;
}

/** 엑셀 결산 파일을 올리면 채워지는 지난달들 */
export const importedStatements: MonthlyStatement[] = [
  { month: '7월', revenue: 18_240_000, ingredients: 6_310_000, payroll: 4_200_000, rent: 2_200_000, other: 1_180_000 },
  { month: '8월', revenue: 19_620_000, ingredients: 6_890_000, payroll: 4_200_000, rent: 2_200_000, other: 1_340_000 },
  { month: '9월', revenue: 18_910_000, ingredients: 6_540_000, payroll: 4_350_000, rent: 2_200_000, other: 1_260_000 },
];

/** 이번 달 — 입출금 문자 · 거래명세서 메일 · POS 에서 하루가 자동으로 기록 중 */
export const currentStatement: MonthlyStatement = {
  month: '10월',
  revenue: 14_380_000,
  ingredients: 5_020_000,
  payroll: 2_900_000,
  rent: 0,
  other: 870_000,
  partial: true,
};

export interface UpcomingPayment {
  id: string;
  title: string;
  amount: number;
  due: string;
}

export const upcomingPayments: UpcomingPayment[] = [
  { id: 'pay1', title: '10월 월세', amount: 2_200_000, due: later(4 * DAY) },
  { id: 'pay2', title: '서울유업 10월 물품 대금', amount: 1_840_000, due: later(6 * DAY) },
  { id: 'pay3', title: '카드 대금', amount: 960_000, due: later(9 * DAY) },
  { id: 'pay4', title: '아르바이트 급여', amount: 1_450_000, due: later(10 * DAY) },
];

export type LedgerSource = '입출금 문자' | '거래명세서 메일' | 'POS' | '엑셀';

export interface LedgerEntry {
  id: string;
  at: string;
  direction: 'in' | 'out';
  amount: number;
  memo: string;
  source: LedgerSource;
  /** 하루가 용도를 확신하지 못해 사장님 확인이 필요한 기록 */
  needsReview: boolean;
}

export const ledgerEntries: LedgerEntry[] = [
  { id: 'l1', at: ago(35 * MIN), direction: 'in', amount: 286_000, memo: '스마트스토어 정산', source: '입출금 문자', needsReview: false },
  { id: 'l2', at: ago(2 * HOUR), direction: 'in', amount: 150_000, memo: '김*수 이체 — 용도 확인 필요', source: '입출금 문자', needsReview: true },
  { id: 'l3', at: ago(5 * HOUR), direction: 'out', amount: 1_840_000, memo: '서울유업 10월 거래명세서 (매입)', source: '거래명세서 메일', needsReview: false },
  { id: 'l4', at: ago(14 * HOUR), direction: 'in', amount: 742_000, memo: '어제 매장 카드 매출', source: 'POS', needsReview: false },
  { id: 'l5', at: ago(1 * DAY), direction: 'out', amount: 64_000, memo: '포장 박스 (쿠팡)', source: '입출금 문자', needsReview: false },
];

/** 엑셀을 올렸을 때 하루가 인식한 시트와 반영 위치 (더미) */
export const excelImportSheets: { sheet: string; rows: number; mapsTo: string }[] = [
  { sheet: '월별 결산', rows: 3, mapsTo: '월별 손익표' },
  { sheet: '일자별 매출', rows: 92, mapsTo: '매출 추이' },
  { sheet: '입출금', rows: 86, mapsTo: '장부' },
  { sheet: '상품 마진', rows: 24, mapsTo: '재료 · 발주 마진율' },
];

export const excelImportSteps = ['파일 읽기', '시트 인식', '항목 매핑', '장부 반영'];

export const financeRules: { id: string; label: string; enabled: boolean }[] = [
  { id: 'sms', label: '입출금 알림 문자를 읽어 장부에 기록', enabled: true },
  { id: 'invoice', label: '거래명세서 메일이 오면 매입으로 기록', enabled: true },
  { id: 'nightly', label: '매일 밤 11시, 결산 엑셀 시트 자동 작성', enabled: true },
  { id: 'review', label: '용도가 불분명한 입출금은 확인받기', enabled: true },
];
