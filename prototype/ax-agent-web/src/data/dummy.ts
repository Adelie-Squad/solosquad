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
  /** Arc 의 스페이스 색상처럼 창 전체 배경 그라디언트를 바꾼다 */
  gradient: string;
  accent: string;
}

export const spaces: Space[] = [
  {
    id: 'momo',
    name: '모모 베이커리',
    emoji: '🥐',
    gradient: 'linear-gradient(135deg, #b9a7ff 0%, #f6b8d6 55%, #ffd9b8 100%)',
    accent: '#6d4aff',
  },
  {
    id: 'momo-2',
    name: '모모 2호점',
    emoji: '🍰',
    gradient: 'linear-gradient(135deg, #8fd3c7 0%, #a5c8ff 60%, #d7c2ff 100%)',
    accent: '#1f8f7a',
  },
];

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
];

export const fallbackReply =
  '알겠어요! 작업 목록에 추가해 두고, 진행 상황은 왼쪽 "실시간 작업"에서 보실 수 있게 할게요.';

// ── 실시간 작업 ──────────────────────────────────────────────────

export interface JobTemplate {
  title: string;
  icon: string;
  steps: string[];
}

/** 실시간 작업 시뮬레이터가 순환시키는 작업 풀 */
export const jobPool: JobTemplate[] = [
  {
    title: '주문 문의 메일 분류',
    icon: '✉️',
    steps: ['받은편지함 확인', '문의 유형 분류', '답장 초안 작성', '자동 발송 기준 검사'],
  },
  {
    title: '네이버 리뷰 답글',
    icon: '💬',
    steps: ['새 리뷰 수집', '감정 분석', '답글 초안 작성', '등록'],
  },
  {
    title: '일일 매출 정리',
    icon: '📊',
    steps: ['POS 데이터 가져오기', '스마트스토어 주문 합산', '전일 대비 비교', '리포트 작성'],
  },
  {
    title: '재고 점검',
    icon: '📦',
    steps: ['재료 사용량 계산', '잔여 재고 추정', '발주 필요 품목 표시'],
  },
  {
    title: '인스타그램 게시물 준비',
    icon: '📣',
    steps: ['신메뉴 정보 정리', '문구 초안 3개 작성', '해시태그 선정'],
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
  status: TaskStatus;
  due: string;
  priority: 'high' | 'normal' | 'low';
}

export const tasks: Task[] = [
  { id: 't1', title: '버터 발주서 승인', source: '대화', assignee: '사장님', status: 'todo', due: later(5 * HOUR), priority: 'high' },
  { id: 't2', title: '단체 주문 견적 답장 검토', source: '메일', assignee: '사장님', status: 'todo', due: later(3 * HOUR), priority: 'high' },
  { id: 't3', title: '별점 2점 리뷰 답글 확인', source: '리뷰', assignee: '사장님', status: 'todo', due: later(1 * DAY), priority: 'normal' },
  { id: 't4', title: '주문 문의 메일 분류', source: '스케줄러', assignee: 'AI', status: 'in_progress', due: later(20 * MIN), priority: 'normal' },
  { id: 't5', title: '주말 신메뉴 인스타 게시물 준비', source: '대화', assignee: 'AI', status: 'in_progress', due: later(2 * DAY), priority: 'normal' },
  { id: 't6', title: '10월 거래명세서 장부 기록', source: '메일', assignee: 'AI', status: 'done', due: ago(4 * HOUR), priority: 'low' },
  { id: 't7', title: '네이버 리뷰 7건 답글 등록', source: '스케줄러', assignee: 'AI', status: 'done', due: ago(8 * HOUR), priority: 'normal' },
  { id: 't8', title: '부가세 신고 자료 정리', source: '대화', assignee: 'AI', status: 'todo', due: later(6 * DAY), priority: 'normal' },
];

// ── 자동화 스케줄러 ──────────────────────────────────────────────

export interface Schedule {
  id: string;
  name: string;
  description: string;
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
    cadence: '매일 오전 7:00',
    nextRun: later(14 * HOUR),
    enabled: true,
    lastResult: { ok: true, summary: '보고 1건 생성', at: ago(10 * HOUR) },
  },
  {
    id: 's2',
    name: '주문 문의 메일 처리',
    description: '새 메일을 분류하고 기준에 맞는 문의는 자동 답장',
    cadence: '30분마다',
    nextRun: later(12 * MIN),
    enabled: true,
    lastResult: { ok: true, summary: '4건 처리 · 1건 검토 요청', at: ago(18 * MIN) },
  },
  {
    id: 's3',
    name: '리뷰 답글',
    description: '네이버 · 카카오맵 새 리뷰에 답글 작성 (3점 이하 보류)',
    cadence: '매일 오후 9:00',
    nextRun: later(5 * HOUR),
    enabled: true,
    lastResult: { ok: true, summary: '7건 등록 · 1건 보류', at: ago(19 * HOUR) },
  },
  {
    id: 's4',
    name: '주간 매출 리포트',
    description: '품목별 · 시간대별 매출과 다음 주 제안',
    cadence: '매주 월요일 오전 8:00',
    nextRun: later(4 * DAY),
    enabled: true,
    lastResult: { ok: true, summary: '리포트 1건 생성', at: ago(3 * DAY) },
  },
  {
    id: 's5',
    name: '재고 발주 점검',
    description: '재료 소진 예측 후 발주서 초안 작성',
    cadence: '매주 화 · 금 오후 2:00',
    nextRun: later(1 * DAY),
    enabled: true,
    lastResult: { ok: false, summary: 'POS 연결 시간 초과 — 재시도 예정', at: ago(2 * DAY) },
  },
  {
    id: 's6',
    name: '인스타그램 예약 게시',
    description: '승인된 게시물 초안을 지정 시각에 게시',
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

/** '스페이스 추가' 를 누를 때마다 차례로 추가되는 사업장 (다 쓰면 더 추가되지 않는다) */
export const extraSpaces: Space[] = [
  {
    id: 'momo-online',
    name: '모모 온라인몰',
    emoji: '📦',
    gradient: 'linear-gradient(135deg, #ffc9a8 0%, #ffb3c1 55%, #c9b6ff 100%)',
    accent: '#d9480f',
  },
  {
    id: 'momo-catering',
    name: '모모 케이터링',
    emoji: '🎂',
    gradient: 'linear-gradient(135deg, #b8e1ff 0%, #c5f2d6 60%, #fff3b0 100%)',
    accent: '#1971c2',
  },
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
