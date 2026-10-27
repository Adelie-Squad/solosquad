// 더미 데이터 — 실제 백엔드/메일/스케줄러 연동 없이 화면을 채우기 위한 고정 값.
// 시나리오: 중국 공장에서 생활용품을 수입해 스마트스토어 · 쿠팡 · 자사몰에서 파는
// 소규모 커머스 '모아 리빙'(김포 창고) 사장님이 AI 직원 '하루'를 쓰는 상황. 회사 · 사람 · 공장은 모두 가상이다.

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

export type CategoryId = 'finance' | 'sourcing' | 'marketing' | 'cs' | 'logistics';

export interface Category {
  id: CategoryId;
  label: string;
  icon: string;
}

export const categories: Category[] = [
  { id: 'finance', label: '재무', icon: '💰' },
  { id: 'sourcing', label: '상품 소싱', icon: '🏭' },
  { id: 'marketing', label: 'SNS · 마케팅', icon: '📣' },
  { id: 'cs', label: '고객 응대', icon: '💬' },
  { id: 'logistics', label: '물류 · 배송', icon: '🚚' },
];

export const categoryById = Object.fromEntries(categories.map((c) => [c.id, c])) as Record<CategoryId, Category>;

/** 사업장은 하나로 고정 — 배경색 전환 기능은 두지 않는다 */
export const space: Space = {
  id: 'moa',
  name: '모아 리빙',
  emoji: '📦',
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
    title: '주문 문의 메일 14건 답장 초안 작성',
    detail: '11건은 자동 발송 기준(배송 일정 안내)에 맞아 보냈고, 3건은 검토 대기 중이에요.',
  },
  {
    id: 'r2',
    kind: 'done',
    title: '오늘 출고 86건 송장 등록',
    detail: '스마트스토어 · 쿠팡에 송장을 일괄 등록했어요. 주소가 불분명한 2건은 보류했어요.',
  },
  {
    id: 'r3',
    kind: 'attention',
    title: '실리콘 밀폐용기 재고가 9일 치만 남았어요',
    detail: '상품 소싱 워크플로우가 공장 4곳 견적을 받아 두었어요. 고르고 승인만 하시면 발주서를 보낼게요.',
  },
  {
    id: 'r4',
    kind: 'insight',
    title: '접이식 수납함 릴스 조회수 3.2만 — 스토어 유입 +41%',
    detail: '같은 형식으로 실리콘 밀폐용기 릴스를 만들어 두었어요. SNS 자동화에서 승인하면 내일 아침 게시돼요.',
  },
];

export interface SuggestedPrompt {
  id: string;
  icon: string;
  text: string;
}

export const suggestedPrompts: SuggestedPrompt[] = [
  { id: 'p1', icon: '🏭', text: '실리콘 밀폐용기 견적 비교 보여줘' },
  { id: 'p2', icon: '✉️', text: '검토 대기 중인 답장 3건 같이 보자' },
  { id: 'p3', icon: '📈', text: '이번 주 채널별 매출 요약해줘' },
  { id: 'p4', icon: '📣', text: '접이식 수납함 릴스 초안 써줘' },
  { id: 'p5', icon: '🚚', text: '오늘 출고 현황 알려줘' },
  { id: 'p6', icon: '💬', text: '반품 사유 모아서 정리해줘' },
  { id: 'p7', icon: '🧮', text: '이번 달 공장 송금 일정 알려줘' },
  { id: 'p8', icon: '💹', text: '쿠팡 최저가 비교해줘' },
];

/** 홈 대화창의 더미 응답 — 키워드 매칭, 없으면 기본 응답 */
export const cannedReplies: { keywords: string[]; reply: string }[] = [
  {
    keywords: ['견적', '밀폐용기', '공장', '소싱'],
    reply:
      '실리콘 밀폐용기 3종 세트 견적 4건이에요.\n• 닝보 화성 실리콘 ¥16.8 · MOQ 1,000 · 15일\n• 선전 리안 가정용품 ¥15.2 · MOQ 3,000 · 20일\n• 이우 메이자 무역 ¥18.5 · MOQ 500 · 10일\n• 둥관 신위 고무 ¥14.6 · 전화 확인 필요\n예상 마진은 닝보가 42%로 MOQ · 납기까지 가장 균형이 좋아요. 워크플로우 › 상품 소싱에서 고르시면 돼요.',
  },
  {
    keywords: ['답장', '검토', '메일'],
    reply:
      '검토 대기 3건이에요.\n1) 접이식 수납함 50개 대량 구매 견적 문의\n2) 실리콘 용기 전자레인지 사용 문의\n3) 배송 지연 항의\n세 건 모두 초안을 써 두었어요. 메일 탭에서 하나씩 확인하실 수 있어요.',
  },
  {
    keywords: ['매출', '요약', '채널'],
    reply:
      '이번 주 매출은 1,684만원으로 지난주보다 7% 늘었어요.\n• 쿠팡 48% · 스마트스토어 39% · 자사몰 13%\n접이식 수납함이 릴스 이후 스마트스토어에서 가장 많이 팔렸어요.',
  },
  {
    keywords: ['릴스', '인스타', '게시물', '수납함'],
    reply:
      '초안이에요 ✍️\n"좁은 자취방, 30초 만에 정리 끝 📦 접어서 쏙, 펴서 쏙. 오늘 주문하면 내일 도착!"\n썸네일은 정리 전후 비교 컷이 반응이 좋았어요. SNS 자동화에 승인 대기로 올려 둘게요.',
  },
  {
    keywords: ['출고', '송장', '배송'],
    reply:
      '오늘 출고는 86건이에요.\n• 쿠팡 41 · 스마트스토어 33 · 자사몰 12\n• 송장 등록 84건 완료, 주소 불분명 2건 보류\nCJ대한통운 집하는 오후 4시예요. 보류 2건은 Task 에 올려 두었어요.',
  },
  {
    keywords: ['반품', '불만', '리뷰'],
    reply:
      '최근 30일 반품 · 교환은 23건이에요.\n• 사이즈가 생각보다 작다 9건\n• 배송 중 파손 6건\n• 단순 변심 8건\n사이즈 문의가 많은 수납함 상세페이지에 실측 사진을 추가하는 걸 제안드려요.',
  },
  {
    keywords: ['송금', '잔금', 'T/T'],
    reply:
      '이번 달 공장 송금은 2건 남았어요.\n• 닝보 화성 실리콘 잔금 980만원 — 6일 뒤\n• 이우 메이자 샘플비 18만원 — 이번 주\n환율이 오르는 중이라 잔금은 이번 주에 보내는 게 약 12만원 유리해요.',
  },
  {
    keywords: ['최저가', '쿠팡', '가격'],
    reply:
      '실리콘 밀폐용기 3종 세트 국내 최저가예요.\n• 쿠팡 12,900원 (로켓배송)\n• 스마트스토어 13,500원 (무료배송)\n우리 판매가 14,900원은 최저가보다 13% 높아요. 13,900원으로 내려도 닝보 견적 기준 마진 38%가 남아요.',
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
    title: '송장 일괄 등록',
    icon: '🚚',
    category: 'logistics',
    steps: ['신규 주문 수집', '주소 검증', '택배 송장 발급', '판매 채널에 송장 등록'],
    tokensPerTick: 400,
  },
  {
    title: '일일 정산 대조',
    icon: '📊',
    category: 'finance',
    steps: ['스마트스토어 정산 가져오기', '쿠팡 정산 가져오기', '입출금 문자 대조', '결산 시트 작성'],
    tokensPerTick: 500,
  },
  {
    title: '공장 견적 수집',
    icon: '🏭',
    category: 'sourcing',
    steps: ['1688 공장 검색', '중국어 견적 문의 발송', '단가 · MOQ 정리', '마진 계산'],
    tokensPerTick: 1800,
  },
  {
    title: '인스타그램 릴스 준비',
    icon: '📣',
    category: 'marketing',
    steps: ['상품 소구점 정리', '문구 초안 3개 작성', '썸네일 시안 생성', '해시태그 선정'],
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
  { id: 'a1', provider: 'Gmail', address: 'moa.living@gmail.com', connected: true, syncedAt: ago(3 * MIN) },
  { id: 'a2', provider: 'Naver', address: 'moaliving@naver.com', connected: true, syncedAt: ago(11 * MIN) },
  { id: 'a3', provider: 'Outlook', address: '연결되지 않음', connected: false },
];

export type MailLabel = '주문문의' | '대량구매' | '공급사' | '세금계산서' | '광고' | '클레임';

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
    subject: '접이식 수납함 50개 대량 구매 가능할까요?',
    preview: '사무실 비품으로 대형 사이즈 50개를 한 번에 주문하고 싶은데, 견적 받을 수 있을까요?',
    receivedAt: ago(25 * MIN),
    label: '대량구매',
    aiAction: '수량 할인 견적 포함 답장 초안 작성됨',
    needsReview: true,
    unread: true,
  },
  {
    id: 'm2',
    from: '박서준',
    subject: '실리콘 용기 전자레인지 사용 되나요?',
    preview: '뚜껑까지 같이 돌려도 되는지, 식기세척기도 되는지 궁금합니다.',
    receivedAt: ago(1.5 * HOUR),
    label: '주문문의',
    aiAction: '제품 사양서 첨부 답장 초안 작성됨',
    needsReview: true,
    unread: true,
  },
  {
    id: 'm3',
    from: '이도윤',
    subject: '배송이 너무 늦어요',
    preview: '주문한 지 5일이 지났는데 아직 출고 준비중이라고 나옵니다.',
    receivedAt: ago(3 * HOUR),
    label: '클레임',
    aiAction: '송장 조회 후 사과 답장 초안 작성됨',
    needsReview: true,
    unread: false,
  },
  {
    id: 'm4',
    from: '닝보 화성 실리콘 (宁波华晟硅胶)',
    subject: 'Quotation — silicone food container set',
    preview: 'Dear Moa Living, please find our quotation for 3-piece silicone container set attached.',
    receivedAt: ago(5 * HOUR),
    label: '공급사',
    aiAction: '견적을 상품 소싱 워크플로우에 반영함',
    needsReview: false,
    unread: false,
  },
  {
    id: 'm5',
    from: '홈택스',
    subject: '[국세청] 전자세금계산서 발급 안내',
    preview: '모아 리빙 귀하, 전자세금계산서가 발급되었습니다.',
    receivedAt: ago(9 * HOUR),
    label: '세금계산서',
    aiAction: '세무 폴더에 보관함',
    needsReview: false,
    unread: false,
  },
  {
    id: 'm6',
    from: '최유나',
    subject: '제주도도 배송 되나요?',
    preview: '제주도인데 추가 배송비가 있는지, 며칠 걸리는지 궁금해요.',
    receivedAt: ago(14 * HOUR),
    label: '주문문의',
    aiAction: '도서산간 배송 안내 답장 자동 발송함',
    needsReview: false,
    unread: false,
  },
  {
    id: 'm7',
    from: '쿠팡 광고센터',
    subject: '10월 광고 캠페인 성과 리포트',
    preview: '광고 캠페인 성과 리포트가 준비되었습니다. 지금 확인해 보세요.',
    receivedAt: ago(1 * DAY),
    label: '광고',
    aiAction: '재무 워크플로우에 광고비로 기록함',
    needsReview: false,
    unread: false,
  },
];

// ── Task 목록 ────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  source: '메일' | '스케줄러' | '대화' | '워크플로우';
  assignee: 'AI' | '사장님';
  category: CategoryId;
  status: TaskStatus;
  due: string;
  priority: 'high' | 'normal' | 'low';
}

export const tasks: Task[] = [
  { id: 't1', title: '실리콘 밀폐용기 공장 선택 · 발주 승인', source: '워크플로우', assignee: '사장님', category: 'sourcing', status: 'todo', due: later(5 * HOUR), priority: 'high' },
  { id: 't2', title: '대량 구매 견적 답장 검토', source: '메일', assignee: '사장님', category: 'cs', status: 'todo', due: later(3 * HOUR), priority: 'high' },
  { id: 't3', title: '주소 불분명 송장 2건 확인', source: '스케줄러', assignee: '사장님', category: 'logistics', status: 'todo', due: later(4 * HOUR), priority: 'normal' },
  { id: 't4', title: '주문 문의 메일 분류', source: '스케줄러', assignee: 'AI', category: 'cs', status: 'in_progress', due: later(20 * MIN), priority: 'normal' },
  { id: 't5', title: '실리콘 밀폐용기 릴스 준비', source: '워크플로우', assignee: 'AI', category: 'marketing', status: 'in_progress', due: later(1 * DAY), priority: 'normal' },
  { id: 't6', title: '10월 공장 송금 내역 장부 기록', source: '워크플로우', assignee: 'AI', category: 'finance', status: 'done', due: ago(4 * HOUR), priority: 'low' },
  { id: 't7', title: '오늘 출고 86건 송장 등록', source: '스케줄러', assignee: 'AI', category: 'logistics', status: 'done', due: ago(2 * HOUR), priority: 'normal' },
  { id: 't8', title: '부가세 신고 자료 정리', source: '대화', assignee: 'AI', category: 'finance', status: 'todo', due: later(6 * DAY), priority: 'normal' },
  { id: 't9', title: '확인 안 된 입금 1건 용도 알려주기', source: '워크플로우', assignee: '사장님', category: 'finance', status: 'todo', due: later(1 * DAY), priority: 'normal' },
  { id: 't10', title: 'SNS 게시물 2건 승인', source: '워크플로우', assignee: '사장님', category: 'marketing', status: 'todo', due: later(18 * HOUR), priority: 'normal' },
  { id: 't11', title: '경쟁사 신상품 3종 소싱 가능성 조사', source: '대화', assignee: 'AI', category: 'sourcing', status: 'todo', due: later(3 * DAY), priority: 'low' },
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
    description: '어제 채널별 매출 · 오늘 출고 예정 · 재고 경고를 정리해 보고',
    category: 'logistics',
    cadence: '매일 오전 8:00',
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
    name: '송장 일괄 등록',
    description: '오후 집하 전 신규 주문 송장을 발급해 판매 채널에 등록',
    category: 'logistics',
    cadence: '매일 오후 3:00',
    nextRun: later(5 * HOUR),
    enabled: true,
    lastResult: { ok: true, summary: '84건 등록 · 2건 보류', at: ago(19 * HOUR) },
  },
  {
    id: 's4',
    name: '결산 시트 자동 작성',
    description: '하루치 정산 · 입출금을 결산 엑셀 시트에 반영 (재무 관리 워크플로우)',
    category: 'finance',
    cadence: '매일 오후 11:00',
    nextRun: later(9 * HOUR),
    enabled: true,
    lastResult: { ok: true, summary: '시트 3개 갱신', at: ago(15 * HOUR) },
  },
  {
    id: 's5',
    name: '재고 소진 예측 · 견적 수집',
    description: '2주 안에 떨어질 상품을 찾아 공장 견적을 받아 둠 (상품 소싱 워크플로우)',
    category: 'sourcing',
    cadence: '매주 화 · 금 오후 2:00',
    nextRun: later(1 * DAY),
    enabled: true,
    lastResult: { ok: false, summary: '1688 접속 시간 초과 — 해외 IP 로 재시도 예정', at: ago(2 * DAY) },
  },
  {
    id: 's6',
    name: 'SNS 예약 게시',
    description: '승인된 게시물을 지정 시각에 인스타 · 블로그 · 스레드에 게시 (SNS 자동화 워크플로우)',
    category: 'marketing',
    cadence: '매일 오전 9:30',
    nextRun: later(17 * HOUR),
    enabled: true,
    lastResult: { ok: true, summary: '게시물 1건 게시', at: ago(1 * DAY) },
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
  briefingTime: '08:00',
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
  { id: 'wangli', name: '왕리', role: '중국 소싱 담당', emoji: '🧑‍💼', master: false, categories: ['sourcing', 'finance'] },
  { id: 'haneul', name: '김하늘', role: 'SNS · CS · 출고 담당', emoji: '🧑‍💻', master: false, categories: ['marketing', 'cs', 'logistics'] },
];

// ── 토큰 사용량 ──────────────────────────────────────────────────

/** 월 예산과 환산 단가 — 모델 혼합 평균을 가정한 더미 값 */
export const tokenBudget = { monthlyTokens: 8_000_000, krwPerMillion: 14_000 };

/** 이번 달(접속 전까지) 카테고리별 누적 — 실시간 작업 토큰이 여기에 더해진다 */
export const tokenUsageByCategory: Record<CategoryId, number> = {
  marketing: 1_840_000,
  sourcing: 1_260_000,
  cs: 820_000,
  finance: 430_000,
  logistics: 190_000,
};

/** 최근 14일 일별 사용량 (오래된 날 → 오늘) */
export const dailyTokens: { date: string; tokens: number }[] = [
  221_000, 198_000, 287_000, 254_000, 192_000, 118_000, 104_000, 263_000, 291_000, 240_000, 368_000, 312_000,
  176_000, 92_000,
].map((tokens, i, all) => ({ date: ago((all.length - 1 - i) * DAY), tokens }));

/** 이번 달 토큰을 많이 쓴 작업 */
export const tokenTopJobs: { title: string; category: CategoryId; tokens: number; note: string }[] = [
  { title: '접이식 수납함 릴스 · 블로그', category: 'marketing', tokens: 460_000, note: '썸네일 · 이미지 시안 9장 생성' },
  { title: '실리콘 밀폐용기 공장 견적', category: 'sourcing', tokens: 312_000, note: '1688 공장 24곳 탐색 × 중국어 문의' },
  { title: '쿠팡 · 스마트스토어 최저가 비교', category: 'sourcing', tokens: 188_000, note: '경쟁 상품 40개 × 3회 재시도' },
  { title: '9월 결산 시트 작성', category: 'finance', tokens: 96_000, note: '엑셀 4개 시트 집계' },
  { title: '주문 문의 메일 답장', category: 'cs', tokens: 71_000, note: '메일 52건' },
];

// ── 워크플로우 ───────────────────────────────────────────────────
// 하루가 부서 에이전트와 함께 돌리는 3개 업무 흐름. approval 단계에서는 멈추고 사장님 확인을 받는다.

export type WorkflowId = 'finance' | 'sourcing' | 'sns';

export interface WorkflowStep {
  name: string;
  /** 이 단계는 사람이 승인해야 다음으로 넘어간다 (관리 화면에서 켜고 끈다) */
  approval: boolean;
}

export interface Workflow {
  id: WorkflowId;
  name: string;
  icon: string;
  category: CategoryId;
  summary: string;
  triggers: string[];
  cadence: string;
  steps: WorkflowStep[];
  enabled: boolean;
  lastRun: { ok: boolean; summary: string; at: string };
  monthTokens: number;
}

export const workflowCadenceOptions = ['매일 오후 11:00', '매일 오전 8:00', '매주 화 · 금 오후 2:00', '매주 월요일 오전 9:00', '요청할 때만'];

export const defaultWorkflows: Workflow[] = [
  {
    id: 'finance',
    name: '재무 관리',
    icon: '💰',
    category: 'finance',
    summary: '판매 채널 정산 · 입출금 문자 · 결산 엑셀을 모아 장부와 손익표를 자동으로 만들어요.',
    triggers: ['입출금 문자가 올 때', '정산 메일이 올 때'],
    cadence: '매일 오후 11:00',
    steps: [
      { name: '정산 · 입출금 수집', approval: false },
      { name: '장부 분류', approval: false },
      { name: '불분명 건 확인', approval: true },
      { name: '결산 시트 작성', approval: false },
      { name: '손익 리포트', approval: false },
    ],
    enabled: true,
    lastRun: { ok: true, summary: '자동 기록 12건 · 확인 필요 1건', at: ago(15 * HOUR) },
    monthTokens: 430_000,
  },
  {
    id: 'sourcing',
    name: '상품 소싱',
    icon: '🏭',
    category: 'sourcing',
    summary: '1688 · 알리바바에서 공장을 찾아 중국어로 견적을 받고, 국내 최저가와 비교해 마진이 남는 공장만 추려요.',
    triggers: ['재고가 2주 안에 떨어질 때', '소싱 요청을 넣을 때'],
    cadence: '매주 화 · 금 오후 2:00',
    steps: [
      { name: '공장 검색', approval: false },
      { name: '중국어 견적 문의', approval: false },
      { name: '국내 최저가 비교', approval: false },
      { name: '마진 계산', approval: false },
      { name: '공장 선택 · 발주 승인', approval: true },
      { name: '발주서 발송', approval: false },
    ],
    enabled: true,
    lastRun: { ok: true, summary: '견적 4건 수집 · 승인 대기', at: ago(5 * HOUR) },
    monthTokens: 1_260_000,
  },
  {
    id: 'sns',
    name: 'SNS 자동화',
    icon: '📣',
    category: 'marketing',
    summary: '상품 소구점으로 인스타 · 블로그 · 스레드 게시물을 만들고, 승인한 것만 예약 게시한 뒤 성과를 모아요.',
    triggers: ['신상품이 등록될 때', '매주 콘텐츠 기획'],
    cadence: '매주 월요일 오전 9:00',
    steps: [
      { name: '콘텐츠 기획', approval: false },
      { name: '문구 · 이미지 시안', approval: false },
      { name: '게시 승인', approval: true },
      { name: '예약 게시', approval: false },
      { name: '성과 수집', approval: false },
    ],
    enabled: true,
    lastRun: { ok: true, summary: '게시물 2건 생성 · 승인 대기', at: ago(1 * DAY) },
    monthTokens: 1_840_000,
  },
];

// ── 워크플로우: 재무 관리 ─────────────────────────────────────────

export interface MonthlyStatement {
  month: string;
  revenue: number;
  /** 상품 원가 (공장 대금) */
  cogs: number;
  /** 해외 운송 · 관세 · 택배 */
  logistics: number;
  ads: number;
  payroll: number;
  /** 창고 임대료 */
  rent: number;
  other: number;
  /** 진행 중인 달 — 자동 기록으로 채워지는 중 */
  partial?: boolean;
}

/** 엑셀 결산 파일을 올리면 채워지는 지난달들 */
export const importedStatements: MonthlyStatement[] = [
  { month: '7월', revenue: 68_400_000, cogs: 29_800_000, logistics: 7_900_000, ads: 6_200_000, payroll: 7_800_000, rent: 2_600_000, other: 1_900_000 },
  { month: '8월', revenue: 74_100_000, cogs: 32_300_000, logistics: 8_600_000, ads: 7_400_000, payroll: 7_800_000, rent: 2_600_000, other: 2_100_000 },
  { month: '9월', revenue: 71_600_000, cogs: 31_200_000, logistics: 8_200_000, ads: 6_900_000, payroll: 8_100_000, rent: 2_600_000, other: 2_000_000 },
];

/** 이번 달 — 정산 메일 · 입출금 문자 · 판매 채널에서 하루가 자동으로 기록 중 */
export const currentStatement: MonthlyStatement = {
  month: '10월',
  revenue: 52_300_000,
  cogs: 22_900_000,
  logistics: 6_100_000,
  ads: 5_300_000,
  payroll: 5_400_000,
  rent: 0,
  other: 1_300_000,
  partial: true,
};

export interface UpcomingPayment {
  id: string;
  title: string;
  amount: number;
  due: string;
}

export const upcomingPayments: UpcomingPayment[] = [
  { id: 'pay1', title: '김포 창고 10월 임대료', amount: 2_600_000, due: later(4 * DAY) },
  { id: 'pay2', title: '닝보 화성 실리콘 잔금 (T/T)', amount: 9_800_000, due: later(6 * DAY) },
  { id: 'pay3', title: '쿠팡 광고비 정산', amount: 1_900_000, due: later(9 * DAY) },
  { id: 'pay4', title: '직원 급여', amount: 5_400_000, due: later(10 * DAY) },
];

export type LedgerSource = '입출금 문자' | '정산 메일' | '판매 채널' | '엑셀';

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
  { id: 'l1', at: ago(35 * MIN), direction: 'in', amount: 4_860_000, memo: '스마트스토어 주간 정산', source: '판매 채널', needsReview: false },
  { id: 'l2', at: ago(2 * HOUR), direction: 'in', amount: 320_000, memo: '김*수 이체 — 용도 확인 필요', source: '입출금 문자', needsReview: true },
  { id: 'l3', at: ago(5 * HOUR), direction: 'out', amount: 4_200_000, memo: '닝보 화성 실리콘 선금 (T/T 해외송금)', source: '입출금 문자', needsReview: false },
  { id: 'l4', at: ago(14 * HOUR), direction: 'in', amount: 6_120_000, memo: '쿠팡 로켓그로스 정산', source: '정산 메일', needsReview: false },
  { id: 'l5', at: ago(1 * DAY), direction: 'out', amount: 1_380_000, memo: 'CJ대한통운 9월 택배비', source: '정산 메일', needsReview: false },
];

/** 엑셀을 올렸을 때 하루가 인식한 시트와 반영 위치 (더미) */
export const excelImportSheets: { sheet: string; rows: number; mapsTo: string }[] = [
  { sheet: '월별 결산', rows: 3, mapsTo: '월별 손익표' },
  { sheet: '채널별 매출', rows: 92, mapsTo: '매출 추이 (쿠팡 · 스마트스토어 · 자사몰)' },
  { sheet: '입출금', rows: 86, mapsTo: '장부' },
  { sheet: '상품별 마진', rows: 48, mapsTo: '상품 소싱 마진 기준' },
];

export const excelImportSteps = ['파일 읽기', '시트 인식', '항목 매핑', '장부 반영'];

export const financeRules: { id: string; label: string; enabled: boolean }[] = [
  { id: 'sms', label: '입출금 알림 문자를 읽어 장부에 기록', enabled: true },
  { id: 'settle', label: '판매 채널 정산 메일은 매출 · 수수료를 나눠 기록', enabled: true },
  { id: 'nightly', label: '매일 밤 11시, 결산 엑셀 시트 자동 작성', enabled: true },
  { id: 'review', label: '용도가 불분명한 입출금은 확인받기', enabled: true },
];

// ── 워크플로우: 상품 소싱 ─────────────────────────────────────────

/** 위안 → 원 환율 (더미) */
export const CNY_TO_KRW = 192;
/** 판매 채널 수수료율 (쿠팡 · 스마트스토어 평균 가정) */
export const CHANNEL_FEE_RATE = 0.11;

export interface SourcingRequest {
  id: string;
  product: string;
  /** 우리 판매가 */
  sellPrice: number;
  qty: number;
  /** 개당 해외 운송 · 관세 · 입고 + 국내 택배 (무료배송 가정) */
  landingPerUnit: number;
  /** 국내 최저가 */
  marketLowest: { channel: string; price: number }[];
  status: 'searching' | 'quoted' | 'ordered';
  createdAt: string;
}

export const defaultSourcingRequests: SourcingRequest[] = [
  {
    id: 'sr1',
    product: '실리콘 밀폐용기 3종 세트',
    sellPrice: 14_900,
    qty: 2_000,
    landingPerUnit: 3_800,
    marketLowest: [
      { channel: '쿠팡', price: 12_900 },
      { channel: '스마트스토어', price: 13_500 },
    ],
    status: 'quoted',
    createdAt: ago(2 * DAY),
  },
  {
    id: 'sr2',
    product: '접이식 수납함 (대)',
    sellPrice: 19_800,
    qty: 1_000,
    landingPerUnit: 4_600,
    marketLowest: [
      { channel: '쿠팡', price: 17_900 },
      { channel: '스마트스토어', price: 18_400 },
    ],
    status: 'searching',
    createdAt: ago(6 * HOUR),
  },
];

export type QuoteContact = 'replied' | 'sent' | 'call';

export interface FactoryQuote {
  id: string;
  requestId: string;
  factory: string;
  city: string;
  platform: '1688' | '알리바바';
  unitCny: number;
  moq: number;
  leadDays: number;
  rating: number;
  /** replied = 견적 받음 · sent = 문의 발송, 답 대기 · call = 서면 답이 없어 전화가 필요 (긴급) */
  contact: QuoteContact;
}

export const factoryQuotes: FactoryQuote[] = [
  { id: 'q1', requestId: 'sr1', factory: '닝보 화성 실리콘 (宁波华晟硅胶)', city: '닝보', platform: '1688', unitCny: 16.8, moq: 1_000, leadDays: 15, rating: 4.8, contact: 'replied' },
  { id: 'q2', requestId: 'sr1', factory: '선전 리안 가정용품 (深圳利安家居)', city: '선전', platform: '1688', unitCny: 15.2, moq: 3_000, leadDays: 20, rating: 4.6, contact: 'replied' },
  { id: 'q3', requestId: 'sr1', factory: '이우 메이자 무역 (义乌美佳贸易)', city: '이우', platform: '알리바바', unitCny: 18.5, moq: 500, leadDays: 10, rating: 4.9, contact: 'replied' },
  { id: 'q4', requestId: 'sr1', factory: '둥관 신위 고무 (东莞鑫宇橡胶)', city: '둥관', platform: '1688', unitCny: 14.6, moq: 2_000, leadDays: 25, rating: 4.3, contact: 'call' },
  { id: 'q5', requestId: 'sr2', factory: '항저우 요우나 수납 (杭州优纳收纳)', city: '항저우', platform: '1688', unitCny: 31.0, moq: 500, leadDays: 18, rating: 4.7, contact: 'sent' },
  { id: 'q6', requestId: 'sr2', factory: '이우 진청 플라스틱 (义乌金程塑料)', city: '이우', platform: '알리바바', unitCny: 27.5, moq: 1_000, leadDays: 22, rating: 4.5, contact: 'sent' },
];

// ── 워크플로우: SNS 자동화 ────────────────────────────────────────

export type SnsChannel = '인스타그램' | '네이버 블로그' | '스레드';

export type SnsStatus = 'draft' | 'review' | 'scheduled' | 'published';

export interface SnsPost {
  id: string;
  channel: SnsChannel;
  format: string;
  title: string;
  caption: string;
  product: string;
  status: SnsStatus;
  /** 예약 · 게시 시각 */
  at: string | null;
  metrics?: { reach: number; clicks: number };
}

export const snsChannels: { channel: SnsChannel; handle: string; connected: boolean }[] = [
  { channel: '인스타그램', handle: '@moa.living', connected: true },
  { channel: '네이버 블로그', handle: 'blog.naver.com/moaliving', connected: true },
  { channel: '스레드', handle: '@moa.living', connected: true },
];

export const defaultSnsPosts: SnsPost[] = [
  {
    id: 'sp1',
    channel: '인스타그램',
    format: '릴스',
    title: '실리콘 밀폐용기 — 전자레인지 OK',
    caption: '뚜껑째 돌려도 OK 🔥 냄새 안 배는 실리콘 3종 세트. 남은 반찬, 이제 그대로 데우세요.',
    product: '실리콘 밀폐용기 3종 세트',
    status: 'review',
    at: later(18 * HOUR),
  },
  {
    id: 'sp2',
    channel: '스레드',
    format: '텍스트 + 이미지',
    title: '이번 주 신상 3종',
    caption: '이번 주 새로 들어온 정리템 3종 🧺 어떤 게 제일 끌리세요?',
    product: '신상품 3종',
    status: 'review',
    at: later(1 * DAY + 3 * HOUR),
  },
  {
    id: 'sp3',
    channel: '인스타그램',
    format: '캐러셀',
    title: '할로윈 한정 세트',
    caption: '이번 주말까지만 🎃 수납함 + 밀폐용기 할로윈 한정 세트.',
    product: '할로윈 한정 세트',
    status: 'scheduled',
    at: later(2 * DAY),
  },
  {
    id: 'sp4',
    channel: '네이버 블로그',
    format: '블로그 글',
    title: '수입 생활용품 고르는 법 — 실리콘 편',
    caption: '식품용 실리콘 인증 확인하는 법부터 세척 팁까지 정리했어요.',
    product: '실리콘 밀폐용기 3종 세트',
    status: 'draft',
    at: null,
  },
  {
    id: 'sp5',
    channel: '인스타그램',
    format: '릴스',
    title: '접이식 수납함 30초 정리 전후',
    caption: '좁은 자취방, 30초 만에 정리 끝 📦 접어서 쏙, 펴서 쏙.',
    product: '접이식 수납함 (대)',
    status: 'published',
    at: ago(2 * DAY),
    metrics: { reach: 32_400, clicks: 1_210 },
  },
  {
    id: 'sp6',
    channel: '네이버 블로그',
    format: '블로그 글',
    title: '자취방 주방 수납 꿀템 5',
    caption: '원룸 주방을 넓게 쓰는 수납 아이템 5가지를 직접 써보고 골랐어요.',
    product: '접이식 수납함 (대)',
    status: 'published',
    at: ago(4 * DAY),
    metrics: { reach: 8_900, clicks: 640 },
  },
];

/** '새 게시물 만들기' 에서 고를 수 있는 상품 */
export const snsProducts = ['실리콘 밀폐용기 3종 세트', '접이식 수납함 (대)', '할로윈 한정 세트'];

// ── 사무실 ──────────────────────────────────────────────────────
// 부서(카테고리)마다 방 하나, 방마다 워커 에이전트 2~3명. 각 방의 첫 번째 에이전트가
// 그 부서의 실시간 작업을 맡고, 나머지는 ambient 문장을 돌아가며 보여준다.

/** 방 바닥 틴트와 워커 몸 색 — 부서 구분용. 글자는 항상 텍스트 색을 쓴다 */
export const roomColors: Record<CategoryId, { tint: string; body: string }> = {
  finance: { tint: '#eaf7f1', body: '#2f9e75' },
  sourcing: { tint: '#fff3e3', body: '#e08a1e' },
  marketing: { tint: '#fdecf3', body: '#d6457a' },
  cs: { tint: '#eaf1fe', body: '#3b7be8' },
  logistics: { tint: '#f1edff', body: '#7c5cff' },
};

export interface OfficeAgent {
  id: string;
  name: string;
  category: CategoryId;
  role: string;
  /** 실시간 작업이 없을 때 돌아가며 보여줄 일 */
  ambient: string[];
  /** 이번 달 완료한 일 (더미) */
  doneThisMonth: number;
}

export const officeAgents: OfficeAgent[] = [
  { id: 'fin-settle', name: '정산 에이전트', category: 'finance', role: '판매 채널 정산 · 입출금 문자를 장부로', ambient: ['스마트스토어 정산 대기 중', '입출금 문자 확인 중', '결산 시트 검토 중'], doneThisMonth: 182 },
  { id: 'fin-tax', name: '세무 에이전트', category: 'finance', role: '세금계산서 · 부가세 자료 정리', ambient: ['세금계산서 분류 중', '부가세 자료 정리 중', '환율 모니터링 중'], doneThisMonth: 46 },
  { id: 'src-factory', name: '공장 탐색 에이전트', category: 'sourcing', role: '1688 · 알리바바 공장 탐색과 견적', ambient: ['신상품 후보 공장 탐색 중', '공장 평점 · 거래 이력 확인 중', '샘플 배송 추적 중'], doneThisMonth: 64 },
  { id: 'src-price', name: '가격 비교 에이전트', category: 'sourcing', role: '쿠팡 · 스마트스토어 최저가 모니터링', ambient: ['쿠팡 최저가 모니터링 중', '경쟁 상품 가격 변동 확인 중', '마진 기준 재계산 중'], doneThisMonth: 210 },
  { id: 'src-interp', name: '통역 에이전트', category: 'sourcing', role: '중국어 문의 · 발주서 · 답장 번역', ambient: ['중국어 견적 메일 번역 중', '위챗 메시지 정리 중', '발주서 중국어 검수 중'], doneThisMonth: 88 },
  { id: 'mkt-plan', name: '콘텐츠 기획 에이전트', category: 'marketing', role: '상품 소구점 정리 · 게시물 기획', ambient: ['다음 주 콘텐츠 캘린더 정리 중', '경쟁사 릴스 반응 분석 중', '해시태그 트렌드 확인 중'], doneThisMonth: 37 },
  { id: 'mkt-design', name: '디자인 에이전트', category: 'marketing', role: '썸네일 · 상세페이지 이미지 시안', ambient: ['썸네일 시안 다듬는 중', '상세페이지 실측 이미지 준비 중', '브랜드 색상 맞추는 중'], doneThisMonth: 52 },
  { id: 'mkt-report', name: '성과 분석 에이전트', category: 'marketing', role: '게시물 도달 · 스토어 유입 분석', ambient: ['어제 게시물 도달 집계 중', '스토어 유입 경로 분석 중', '광고 효율 비교 중'], doneThisMonth: 29 },
  { id: 'cs-mail', name: '메일 응대 에이전트', category: 'cs', role: '주문 문의 분류 · 답장 초안', ambient: ['받은편지함 확인 중', '자주 묻는 질문 정리 중', '답장 문구 다듬는 중'], doneThisMonth: 312 },
  { id: 'cs-review', name: '리뷰 답글 에이전트', category: 'cs', role: '스토어 리뷰 답글 · 반품 사유 정리', ambient: ['새 리뷰 확인 중', '반품 사유 분류 중', '별점 낮은 리뷰 정리 중'], doneThisMonth: 141 },
  { id: 'log-invoice', name: '송장 에이전트', category: 'logistics', role: '송장 발급 · 판매 채널 등록', ambient: ['다음 집하 시간 대기 중', '배송 지연 건 추적 중', '반품 회수 일정 확인 중'], doneThisMonth: 1_940 },
  { id: 'log-stock', name: '재고 예측 에이전트', category: 'logistics', role: '재고 소진 예측 · 입고 일정', ambient: ['재고 소진 예측 갱신 중', '입고 컨테이너 위치 확인 중', '창고 적재율 계산 중'], doneThisMonth: 58 },
];
