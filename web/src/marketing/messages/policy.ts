// The privacy policy of the marketing site (`/privacy`, 2026-11-14). Korean is the authoritative text;
// en and zh-CN are translations (the page says the Korean version prevails). It lives here, under
// messages/, as structured content rather than flat i18n keys — it is long prose, read only by
// Policy.tsx.
//
// DRAFT — not yet reviewed by a lawyer (법률 검토 전 초안). Do not show that on the page; track it
// in marketing/README.md. The imweb policy was used only as a list of the sections a Korean SaaS
// policy covers; every sentence here describes what this site's code does:
//   - inquiries · inquiry_log: marketing/migrations/0001…0004, src/inquiry.ts (retain_until = sent +
//     RETAIN_DAYS 365; the daily sweep, cron "17 3 * * *" UTC = 12:17 KST)
//   - demo_accounts · demo_events: src/demo.ts (PBKDF2 hash; events login/logout/view/action, no IP,
//     UA or text; sweepDemo: events older than RETAIN_DAYS, accounts RETAIN_DAYS after they end)
//   - rate_limits: src/http.ts (salted SHA-256 of the IP, the demo ID for login attempts; rows older
//     than a day go on every check and in the sweep)
//   - the cookie ss_demo: HttpOnly · Secure · SameSite=Lax, ≤ 12 h (src/demo.ts SESSION_SECONDS)
//   - browser storage: solosquad.locale · solosquad.theme · solosquad.companyCode · the demo's view
//     settings; sessionStorage solosquad.demoPrefill (ID + number, removed when /demo opens)
//   - Cloudflare, Inc. (US) hosts the Worker and D1; the D1 location hint is `apac`
//     (marketing/README.md deploy step 3); D1 Time Travel keeps deleted rows restorable ≤ 30 days
//   - no mail provider yet (src/mail.ts is a no-op); no analytics, no ad pixels, no external fonts
// When any of these change, change this text, SITE.policyEffective and CONSENT_VERSION together.
import type { Locale } from '../../i18n';
import { SITE } from './site';

export type PolicyBlock = { p: string } | { ul: string[] } | { table: { head: string[]; rows: string[][] } };

export interface PolicySection {
  id: string;
  title: string;
  blocks: PolicyBlock[];
}

export interface PolicyDoc {
  intro: string;
  sections: PolicySection[];
}

/** The section ids, in order — the same in every language (anchors `#policy-<id>`). */
export const POLICY_SECTIONS = ['purpose', 'items', 'retention', 'destruction', 'third-party', 'transfer', 'rights', 'security', 'cookies', 'officer', 'remedies', 'changes'] as const;

const doc = (intro: string, titles: string[], bodies: PolicyBlock[][]): PolicyDoc => ({
  intro,
  sections: POLICY_SECTIONS.map((id, i) => ({ id, title: titles[i], blocks: bodies[i] })),
});

function ko(): PolicyDoc {
  const owner = SITE.owner.ko;
  const email = SITE.email;
  const [y, m, d] = SITE.policyEffective.split('-').map(Number);
  return doc(
    `${SITE.brand}(이하 ‘저희’)는 이 사이트(첫 화면 · 데모 계정 신청 · 데모 로그인 · 데모)에서 받는 개인정보를 「개인정보 보호법」에 따라 처리해요. 이 방침은 어떤 정보를 왜 받고, 얼마 동안 두었다가 어떻게 지우는지, 그리고 정보주체가 어떤 권리를 어떻게 쓸 수 있는지 알려 드려요. 회사 서버에 설치한 ${SITE.brand} 는 그 회사가 직접 운영하므로, 그 안의 정보는 이 방침이 아니라 그 회사의 방침을 따라요.`,
    [
      '1. 개인정보의 처리 목적',
      '2. 처리하는 개인정보의 항목',
      '3. 보유 · 이용 기간',
      '4. 파기 절차와 방법',
      '5. 제3자 제공',
      '6. 처리 위탁과 국외 이전',
      '7. 정보주체의 권리와 행사 방법',
      '8. 안전성 확보 조치',
      '9. 쿠키 등 자동 수집 장치',
      '10. 개인정보 보호책임자',
      '11. 권익침해 구제 방법',
      '12. 방침의 변경과 시행일',
    ],
    [
      [
        { p: '받은 개인정보는 아래 목적에만 써요. 목적이 바뀌면 미리 알리고, 필요하면 다시 동의를 받아요.' },
        {
          ul: [
            '데모 계정 발급과 데모 로그인 확인 — 신청한 이메일이 데모 아이디가 되고, 법인(사업자)등록번호와 비밀번호로 로그인하는 사람을 확인해요.',
            '상담 연락 — 신청 내용을 확인하고 이메일 · 전화 · 메신저로 연락해요.',
            '상담 준비 — 데모 계정을 신청하며 동의한 분의 데모 사용 기록(본 화면 · 누른 버튼)을 상담할 때 참고해요.',
            '새 소식 안내 — ‘새 소식 받기’에 따로 동의한 분에게만 보내요.',
            '부정 이용 방지 — 같은 곳에서 지나치게 많은 신청 · 로그인 시도가 들어오는 것을 막아요.',
          ],
        },
      ],
      [
        {
          table: {
            head: ['언제', '항목', '필수 · 선택'],
            rows: [
              ['데모 계정 · 상담 신청', '회사 이름, 나라, 회사의 등록번호와 그 구분(한국 개인사업자의 사업자등록번호 · 한국 법인의 법인등록번호 · 중국 회사의 통일사회신용코드 · 다른 나라의 등록번호), 업종, 담당자 이름, 이메일, 맡기고 싶은 일, 원하는 것(데모 계정 · 상담), 동의 여부와 동의 문구의 버전', '필수'],
              ['데모 계정을 원할 때', '전화번호 — 중국은 휴대전화 번호(뒤 4자리가 데모 비밀번호에 들어가요)', '필수'],
              ['신청할 때 고를 수 있는 것', '전화번호(상담만 원할 때), 메신저 종류(카카오톡 · WeChat)와 메신저 ID, 더 알려 주실 것(직접 쓰는 글), 새 소식 받기 동의', '선택'],
              ['신청과 함께 저절로', '화면 언어, 신청한 자리(첫 화면 · 가격 · 데모 로그인 등), 양식을 연 시각과 보낸 시각, 신청의 처리 기록(접수 · 발급 시각)', '—'],
              ['데모 계정', '아이디(신청한 이메일), 법인(사업자)등록번호와 그 구분, 회사 이름, 화면 언어, 비밀번호의 해시값(원래 비밀번호는 저장하지 않아요), 만든 · 바뀐 · 끝나는 시각', '—'],
              ['데모를 쓸 때(데모 계정 신청 시 동의)', '로그인 · 로그아웃 · 본 화면 · 누른 버튼(예: 예시 워크플로우 실행, 승인), 예시 워크플로우를 시작하고 끝까지 마쳤는지(승인 · 거절)와 그 시각. IP 주소 · 브라우저 정보 · 직접 쓴 글은 기록하지 않아요.', '데모 계정 신청 시 필수'],
              ['신청 · 로그인을 보낼 때', '접속 IP 주소를 비밀값과 섞어 바꾼 해시값(원래 IP 는 저장하지 않아요), 로그인을 시도한 아이디 — 시도 횟수를 세는 데만 써요.', '—'],
            ],
          },
        },
        { p: '이 사이트는 회원 가입을 받지 않고, 위에 적지 않은 정보는 받지 않아요.' },
      ],
      [
        {
          table: {
            head: ['정보', '보유 기간'],
            rows: [
              ['신청 내용과 그 처리 기록', '신청한 날부터 1년(365일)'],
              ['데모 계정', '사용 기간(기본 14일)이 끝나거나 중지된 날부터 1년 — 같은 이메일로 다시 신청하면 이어 쓰려고 둬요.'],
              ['데모 사용 기록', '기록된 날부터 1년. 데모 계정이 지워지면 함께 지워요.'],
              ['시도 횟수 기록(해시값 · 아이디)', '횟수를 세는 기간(1분 · 1시간 · 하루)이 지난 뒤 길어도 이틀 안'],
              ['데모 로그인 쿠키(브라우저)', '로그인부터 최대 12시간, 데모 계정이 그보다 먼저 끝나면 그때까지. 로그아웃하면 바로 지워요.'],
            ],
          },
        },
        { p: '요청하면 이 기간 전에도 지워요(7번). 법령이 따로 보관을 요구하는 경우가 생기면 그 기간 동안 다른 정보와 나눠 보관해요.' },
      ],
      [
        {
          ul: [
            '절차 — 매일 한 번(한국 시각 낮 12시 17분) 자동 작업이 보유 기간이 지난 신청 내용 · 처리 기록 · 데모 계정 · 데모 사용 기록 · 시도 횟수 기록을 데이터베이스에서 지워요. 사람이 따로 고르지 않아요.',
            '방법 — 데이터베이스에서 행을 삭제해요. 다만 저장소인 Cloudflare D1 의 복구 기능(Time Travel) 때문에 지운 뒤 최대 30일 동안은 Cloudflare 의 복구용 기록에 남을 수 있고, 그 뒤 사라져요. 저희는 이 기능으로 지운 개인정보를 되살리지 않아요.',
            '요청으로 지울 때 — 7번의 방법으로 요청을 받으면 해당 정보를 데이터베이스에서 바로 지워요.',
            '데모 계정 안내는 신청 완료 화면에 한 번 보여 줄 뿐, 비밀번호를 따로 적어 두거나 출력하지 않아요.',
          ],
        },
      ],
      [
        { p: '받은 개인정보를 다른 회사나 사람에게 제공하지 않아요. 법령에 정해진 절차(영장 등)에 따라 요구가 있을 때만 예외로 해요.' },
      ],
      [
        { p: '이 사이트는 Cloudflare 의 서버에서 돌아가고, 신청 내용과 데모 계정은 Cloudflare 의 데이터베이스(D1)에 저장돼요. 이를 위해 아래와 같이 처리를 맡기며, 이는 개인정보의 국외 이전에 해당해요.' },
        {
          table: {
            head: ['항목', '내용'],
            rows: [
              ['받는 자', 'Cloudflare, Inc. (미국 회사) — 101 Townsend St., San Francisco, CA 94107, USA · privacyquestions@cloudflare.com'],
              ['맡기는 일', '사이트 호스팅, 데이터베이스(D1) 보관, 네트워크 전송, 보안(봇 확인 기능을 켜면 그 확인 포함)'],
              ['이전 국가와 위치', '미국 회사가 운영하는 서비스예요. 데이터베이스는 아시아 · 태평양(APAC) 위치 힌트로 만들어요 — 위치 힌트는 Cloudflare 가 그 지역 안에서 데이터센터를 고르는 데 쓰는 값이라 특정 나라를 보장하지 않아요. 요청은 가까운 Cloudflare 데이터센터를 거치며, 한국 밖일 수 있어요.'],
              ['이전 시기와 방법', '신청을 보내거나 데모에 로그인 · 데모를 쓸 때마다 암호화된 연결(HTTPS)로 전송돼 저장돼요.'],
              ['이전하는 항목', '2번의 모든 항목'],
              ['보유 기간', '3번과 같아요. 위탁 계약이 끝나면 지워요.'],
              ['거부 방법과 그 결과', `국외 이전을 원하지 않으면 신청 양식의 동의를 하지 않으면 돼요. 그러면 이 사이트로 데모 계정 · 상담 신청을 받을 수 없고, 대신 ${email} 로 직접 연락할 수 있어요.`],
            ],
          },
        },
        { p: '지금은 메일 자동 발송 서비스를 쓰지 않아요. 데모 계정 안내 메일을 자동으로 보내게 되면 그 업체를 이 표에 더하고 이 방침을 바꿔 알려 드려요.' },
      ],
      [
        {
          ul: [
            '정보주체는 언제든 자기 개인정보의 열람, 정정, 삭제, 처리 정지, 동의 철회를 요구할 수 있어요. 새 소식 받기 동의만 따로 철회할 수도 있어요.',
            `요구는 ${email} 로 이메일을 보내 주세요. 본인 확인을 위해 신청할 때 쓴 이메일 주소에서 보내 주시고, 확인이 더 필요하면 신청한 회사 이름이나 등록번호를 여쭤볼 수 있어요.`,
            '법정대리인이나 위임을 받은 사람도 요구할 수 있어요. 이때는 위임장을 함께 보내 주세요.',
            '요구를 받으면 10일 안에 처리하고 결과를 알려 드려요. 법령에 따라 거절해야 하는 경우에는 그 이유를 알려 드려요.',
            '데모 계정 삭제를 요구하면 그 계정과 데모 사용 기록을 함께 지워요.',
          ],
        },
      ],
      [
        {
          ul: [
            '전송 구간 암호화 — 사이트는 HTTPS(암호화된 연결)로 제공돼요. 데모 로그인 쿠키는 HTTPS 로만 보내져요.',
            '비밀번호 — 원래 값을 저장하지 않고 PBKDF2-SHA256 해시값만 저장해요. 비밀번호는 신청 완료 화면에 한 번만 보여요.',
            'IP 주소 — 원래 값을 저장하지 않고, 비밀값을 섞은 SHA-256 해시값으로 시도 횟수를 세는 데만 써요.',
            '데모 로그인 — 쿠키는 서명돼 있고 스크립트로 읽을 수 없게(HttpOnly) HTTPS 로만(Secure) 보내져요. 쓸 때마다 데이터베이스에서 다시 확인하므로 데모 계정이 끝나거나 중지되면 바로 쓸 수 없어요.',
            '접근 제한 — 저장된 정보를 보는 웹 관리 화면이 없어요. Cloudflare 계정 권한을 받은 운영 담당자만 명령줄 도구로 데이터베이스에 접근해요.',
            '적게 남기기 — 데모 사용 기록에는 IP · 브라우저 정보 · 직접 쓴 글을 남기지 않고, 새 신청이 들어왔다는 내부 알림에는 회사 이름과 요청 종류만 담아요(연락처 없음).',
            '부정 이용 방지 — 신청 · 로그인 시도 횟수를 제한하고, 자동 입력을 걸러 내요.',
            '자동 파기 — 보유 기간이 지난 정보는 매일 자동으로 지워요(4번).',
          ],
        },
      ],
      [
        {
          ul: [
            '쿠키는 하나만 써요 — ss_demo: 데모에 로그인했을 때만 생기고, 로그인 상태를 지키는 데만 써요(3번의 기간). 광고 · 분석 쿠키, 외부 분석 도구(예: Google Analytics), 광고 픽셀은 쓰지 않고, 행태정보로 맞춤형 광고를 하지 않아요.',
            '브라우저 저장소(이 기기에만 남고 서버로 보내지 않아요) — 화면 언어, 테마(라이트 · 다크), 로그인 화면의 회사 코드, 데모 화면의 보기 설정(사이드바 · 사무실 보기 · 확대 정도).',
            '데모 계정 완료 화면에서 데모 로그인으로 넘어갈 때, 아이디와 등록번호를 이 탭의 임시 저장소(sessionStorage)에 잠깐 두고 로그인 화면이 열리면 바로 지워요. 비밀번호는 넣지 않아요.',
            '거부 방법 — 브라우저 설정에서 쿠키를 막거나 사이트 데이터를 지울 수 있어요. 쿠키를 막으면 데모에 로그인할 수 없어요.',
          ],
        },
      ],
      [
        { p: '개인정보 처리에 관한 업무를 총괄하고, 관련 문의 · 불만 · 피해 구제와 열람 요구를 받아요.' },
        {
          table: {
            head: ['구분', '내용'],
            rows: [
              ['개인정보 보호책임자', `${owner} (대표)`],
              ['연락처', email],
            ],
          },
        },
      ],
      [
        { p: '개인정보 침해로 상담이나 피해 구제가 필요하면 아래 기관에 문의할 수 있어요.' },
        {
          table: {
            head: ['기관', '연락처'],
            rows: [
              ['개인정보침해신고센터(한국인터넷진흥원)', '국번 없이 118 · privacy.kisa.or.kr'],
              ['개인정보분쟁조정위원회', '1833-6972 · www.kopico.go.kr'],
              ['대검찰청', '국번 없이 1301 · www.spo.go.kr'],
              ['경찰청', '국번 없이 182 · ecrm.police.go.kr'],
            ],
          },
        },
      ],
      [
        { p: `이 방침은 ${y}년 ${m}월 ${d}일부터 시행해요.` },
        { p: '내용을 바꾸면 시행 7일 전에 이 페이지에 알리고, 받는 항목 · 목적 · 국외 이전처럼 정보주체의 권리에 중요한 변경은 30일 전에 알려요. 바뀐 내용이 동의 문구에 영향을 주면 다시 동의를 받아요.' },
      ],
    ],
  );
}

function en(): PolicyDoc {
  const owner = SITE.owner.en;
  const email = SITE.email;
  const date = new Date(`${SITE.policyEffective}T00:00:00Z`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  return doc(
    `${SITE.brand} (“we”) handles the personal information it receives on this site (the home page, the demo account request, the demo login and the demo) under Korea’s Personal Information Protection Act. This policy explains what we collect and why, how long we keep it and how we delete it, and what rights you have and how to use them. ${SITE.brand} installed on a company’s own server is run by that company, so the information there follows that company’s policy, not this one.`,
    [
      '1. Why we process personal information',
      '2. What we process',
      '3. How long we keep it',
      '4. How we delete it',
      '5. Giving it to third parties',
      '6. Processors and transfer abroad',
      '7. Your rights and how to use them',
      '8. How we keep it safe',
      '9. Cookies and other automatic collection',
      '10. Privacy officer',
      '11. Where to get help',
      '12. Changes and effective date',
    ],
    [
      [
        { p: 'We use what we receive only for the purposes below. If a purpose changes, we tell you first and ask for consent again where needed.' },
        {
          ul: [
            'Issuing demo accounts and checking demo logins — the email in your request becomes the demo ID, and the company registration number and password confirm who signs in.',
            'Getting in touch — we read your request and contact you by email, phone or messenger.',
            'Preparing a consultation — if you agreed when asking for a demo account, we look at your demo usage (screens viewed, buttons pressed) before we talk.',
            'News — only for people who separately ticked “Get news”.',
            'Preventing abuse — stopping too many requests or login attempts from one place.',
          ],
        },
      ],
      [
        {
          table: {
            head: ['When', 'What', 'Required or optional'],
            rows: [
              ['Demo account or consultation request', 'Company name, country, the company’s registration number and its kind (a Korean sole proprietor’s business registration number, a Korean corporation’s corporate registration number, a Chinese company’s unified social credit code, another country’s registration number), industry, contact name, email, what you want to hand over, what you ask for (demo account, consultation), your consents and the version of the consent text', 'Required'],
              ['When you ask for a demo account', 'Phone number — a mobile number in China (its last four digits go into the demo password)', 'Required'],
              ['Optional in the request', 'Phone number (consultation only), messenger (KakaoTalk, WeChat) and messenger ID, anything else you write, consent to news', 'Optional'],
              ['Recorded with the request', 'Screen language, where you sent it from (home page, pricing, demo login, …), when the form was opened and sent, the handling record (received, issued)', '—'],
              ['Demo account', 'ID (your request email), company registration number and its kind, company name, screen language, a hash of the password (never the password itself), when it was made, changed and ends', '—'],
              ['Using the demo (agreed when requesting a demo account)', 'Login, logout, screens viewed and buttons pressed (e.g. running an example workflow, approving), whether an example workflow was started and run to its end (approved or declined), with their times. No IP address, browser details or anything you type.', 'Required for a demo account'],
              ['Sending a request or a login', 'A hash of your IP address mixed with a secret value (the IP itself is not stored) and the ID tried at login — used only to count attempts.', '—'],
            ],
          },
        },
        { p: 'This site has no sign-up and collects nothing not listed above.' },
      ],
      [
        {
          table: {
            head: ['Information', 'Kept for'],
            rows: [
              ['Requests and their handling record', '1 year (365 days) from the request'],
              ['Demo accounts', '1 year after the account ends (14 days by default) or is stopped — so a new request from the same email can continue it.'],
              ['Demo usage', '1 year from when it was recorded; deleted with the demo account.'],
              ['Attempt counters (hash, ID)', 'At most two days after their counting window (a minute, an hour or a day) ends'],
              ['Demo login cookie (browser)', 'Up to 12 hours from login, or until the demo account ends if sooner. Removed at once when you log out.'],
            ],
          },
        },
        { p: 'On request we delete earlier (section 7). If a law ever requires keeping something longer, we keep it apart from other information for that period.' },
      ],
      [
        {
          ul: [
            'Procedure — once a day (12:17 Korean time) an automatic process deletes requests, handling records, demo accounts, demo usage and attempt counters whose period has passed. Nobody picks them by hand.',
            'Method — rows are deleted from the database. Cloudflare D1’s recovery feature (Time Travel) may keep them in Cloudflare’s recovery history for up to 30 days, after which they are gone. We do not use it to bring deleted personal information back.',
            'On request — when we receive a request as in section 7, we delete the information from the database right away.',
            'Demo account details are shown once on the completion screen; we do not write down or print passwords.',
          ],
        },
      ],
      [
        { p: 'We do not give your personal information to other companies or people. The only exception is a demand made through a procedure set by law (such as a warrant).' },
      ],
      [
        { p: 'This site runs on Cloudflare’s servers, and requests and demo accounts are stored in Cloudflare’s database (D1). We entrust this processing as below, which is a transfer of personal information abroad.' },
        {
          table: {
            head: ['Item', 'Details'],
            rows: [
              ['Recipient', 'Cloudflare, Inc. (a US company) — 101 Townsend St., San Francisco, CA 94107, USA · privacyquestions@cloudflare.com'],
              ['What it does', 'Hosting the site, keeping the database (D1), network delivery, security (including the bot check, if it is turned on)'],
              ['Country and location', 'A service run by a US company. The database is created with the Asia-Pacific (APAC) location hint — a hint Cloudflare uses to choose a data centre in that region, not a promise of a particular country. Requests pass through a nearby Cloudflare data centre, which may be outside Korea.'],
              ['When and how', 'Each time you send a request, log in to or use the demo, over an encrypted connection (HTTPS).'],
              ['What is transferred', 'Everything in section 2'],
              ['Kept for', 'As in section 3; deleted when the contract ends.'],
              ['How to refuse, and what follows', `If you do not want the transfer, do not tick the consent in the request form. We then cannot take a demo account or consultation request through this site; you can write to ${email} instead.`],
            ],
          },
        },
        { p: 'We do not use an automatic email service yet. If we start sending demo account emails automatically, we will add that provider to this table and announce the change.' },
      ],
      [
        {
          ul: [
            'You may at any time ask to see, correct or delete your personal information, to stop its processing, or to withdraw your consent. You can withdraw the news consent on its own.',
            `Send your request to ${email}, from the email address you used in your request so we can confirm it is you; we may ask for the company name or registration number if we need more.`,
            'A legal representative or someone you authorise may ask for you, with a letter of authorisation.',
            'We act within 10 days and tell you the result. If the law requires us to refuse, we tell you why.',
            'Deleting a demo account deletes its usage record with it.',
          ],
        },
      ],
      [
        {
          ul: [
            'Encryption in transit — the site is served over HTTPS (an encrypted connection), and the demo login cookie is only ever sent over HTTPS.',
            'Passwords — never stored; only a PBKDF2-SHA256 hash is. The password is shown once, on the completion screen.',
            'IP addresses — never stored as they are; a SHA-256 hash mixed with a secret value is used only to count attempts.',
            'Demo login — the cookie is signed, unreadable by scripts (HttpOnly) and sent only over HTTPS (Secure). It is checked against the database on every use, so an ended or stopped demo account stops working at once.',
            'Access control — there is no web admin screen for stored information. Only operators granted access to the Cloudflare account reach the database, with command-line tools.',
            'Keeping little — demo usage has no IP, browser details or typed text, and the internal notice of a new request carries only the company name and what was asked for (no contact details).',
            'Abuse prevention — request and login attempts are limited, and automated submissions are filtered out.',
            'Automatic deletion — information past its period is deleted every day (section 4).',
          ],
        },
      ],
      [
        {
          ul: [
            'One cookie — ss_demo: set only when you log in to the demo, used only to keep you logged in (period in section 3). No advertising or analytics cookies, no outside analytics tools (such as Google Analytics), no ad pixels, and no targeted advertising based on behaviour.',
            'Browser storage (kept on this device only, never sent to us) — screen language, theme (light or dark), the company code on the login page, the demo’s view settings (sidebar, office view, zoom).',
            'Going from the demo account completion screen to the demo login, the ID and registration number wait in this tab’s temporary storage (sessionStorage) and are removed as soon as the login page opens. The password is never put there.',
            'How to refuse — block cookies or clear site data in your browser settings. Without cookies you cannot log in to the demo.',
          ],
        },
      ],
      [
        { p: 'The privacy officer is responsible for the handling of personal information and receives questions, complaints, requests for remedies and requests to see information.' },
        {
          table: {
            head: ['Item', 'Details'],
            rows: [
              ['Privacy officer', `${owner} (Representative)`],
              ['Contact', email],
            ],
          },
        },
      ],
      [
        { p: 'For advice or remedies about a privacy violation, you can contact these Korean bodies.' },
        {
          table: {
            head: ['Body', 'Contact'],
            rows: [
              ['Personal Information Infringement Report Center (KISA)', '118 (in Korea) · privacy.kisa.or.kr'],
              ['Personal Information Dispute Mediation Committee', '1833-6972 · www.kopico.go.kr'],
              ['Supreme Prosecutors’ Office', '1301 (in Korea) · www.spo.go.kr'],
              ['Korean National Police Agency', '182 (in Korea) · ecrm.police.go.kr'],
            ],
          },
        },
      ],
      [
        { p: `This policy takes effect on ${date}.` },
        { p: 'We announce changes on this page 7 days before they take effect, and 30 days before for changes that matter to your rights, such as the items collected, the purposes or the transfer abroad. If a change affects the consent text, we ask for consent again.' },
      ],
    ],
  );
}

function zhCN(): PolicyDoc {
  const owner = SITE.owner['zh-CN'];
  const email = SITE.email;
  const [y, m, d] = SITE.policyEffective.split('-').map(Number);
  return doc(
    `${SITE.brand}（以下简称“我们”）依照韩国《个人信息保护法》处理在本网站（首页、演示账号申请、演示登录及演示）收到的个人信息。本政策说明我们收集哪些信息、为何收集、保存多久、如何删除，以及您享有哪些权利、如何行使。安装在企业自有服务器上的 ${SITE.brand} 由该企业自行运营，其中的信息适用该企业的政策，而非本政策。`,
    [
      '1. 个人信息的处理目的',
      '2. 处理的个人信息项目',
      '3. 保存和使用期限',
      '4. 销毁程序和方法',
      '5. 向第三方提供',
      '6. 委托处理与跨境传输',
      '7. 信息主体的权利及行使方法',
      '8. 安全保障措施',
      '9. Cookie 等自动收集装置',
      '10. 个人信息保护负责人',
      '11. 权益受侵害时的救济途径',
      '12. 政策变更与施行日期',
    ],
    [
      [
        { p: '收到的个人信息仅用于以下目的。目的变更时，我们会事先告知，必要时重新征得同意。' },
        {
          ul: [
            '发放演示账号并核验演示登录——申请时填写的邮箱即演示账号 ID，并以企业注册号和密码确认登录者身份。',
            '联系沟通——查看申请内容，并通过邮件、电话或通讯软件与您联系。',
            '准备咨询——对申请演示账号时同意的用户，咨询时参考其演示使用记录（查看的页面、点击的按钮）。',
            '新消息通知——仅发送给另行勾选“接收新消息”的用户。',
            '防止滥用——阻止来自同一来源的过多申请或登录尝试。',
          ],
        },
      ],
      [
        {
          table: {
            head: ['场景', '项目', '必填或选填'],
            rows: [
              ['申请演示账号或咨询', '公司名称、国家、企业注册号及其类型（韩国个人经营者的营业执照号、韩国法人的法人登记号、中国企业的统一社会信用代码、其他国家的注册号）、行业、联系人姓名、邮箱、想交给我们的工作、申请内容（演示账号、咨询）、同意情况及同意文本的版本', '必填'],
              ['申请演示账号时', '电话号码——中国为手机号（后 4 位用于演示密码）', '必填'],
              ['申请时可选', '电话号码（仅申请咨询时）、通讯软件（KakaoTalk、WeChat）及其 ID、补充说明（自行填写的内容）、接收新消息的同意', '选填'],
              ['随申请自动记录', '界面语言、申请入口（首页、价格、演示登录等）、打开和提交表单的时间、申请的处理记录（受理、发放时间）', '—'],
              ['演示账号', 'ID（申请邮箱）、企业注册号及其类型、公司名称、界面语言、密码的哈希值（不保存密码原文）、创建、修改和到期时间', '—'],
              ['使用演示时（申请演示账号时同意）', '登录、退出、查看的页面、点击的按钮（如运行示例工作流、审批）、示例工作流是否开始并运行到结束（批准或拒绝）及其时间。不记录 IP 地址、浏览器信息或您输入的文字。', '申请演示账号时必填'],
              ['提交申请或登录时', '将访问 IP 地址与密钥混合后的哈希值（不保存 IP 原文），以及登录时尝试的 ID——仅用于统计尝试次数。', '—'],
            ],
          },
        },
        { p: '本网站不提供会员注册，也不收集上表以外的信息。' },
      ],
      [
        {
          table: {
            head: ['信息', '保存期限'],
            rows: [
              ['申请内容及其处理记录', '自申请之日起 1 年（365 天）'],
              ['演示账号', '使用期限（默认 14 天）结束或被停用之日起 1 年——以便同一邮箱再次申请时继续使用。'],
              ['演示使用记录', '自记录之日起 1 年；演示账号删除时一并删除。'],
              ['尝试次数记录（哈希值、ID）', '计数周期（1 分钟、1 小时或 1 天）结束后最多两天内'],
              ['演示登录 Cookie（浏览器）', '自登录起最长 12 小时；若演示账号更早到期，则至到期为止。退出登录时立即删除。'],
            ],
          },
        },
        { p: '应您的要求，我们可在期限届满前删除（第 7 条）。如法律要求另行保存，我们将在该期限内与其他信息分开保存。' },
      ],
      [
        {
          ul: [
            '程序——每天一次（韩国时间 12:17），自动任务从数据库中删除已过保存期限的申请内容、处理记录、演示账号、演示使用记录和尝试次数记录，无需人工挑选。',
            '方法——从数据库中删除相应数据行。但由于存储所用 Cloudflare D1 的恢复功能（Time Travel），删除后最多 30 天内这些数据可能仍保留在 Cloudflare 的恢复记录中，之后即消失。我们不会利用该功能恢复已删除的个人信息。',
            '应要求删除——按第 7 条的方式收到要求后，我们会立即从数据库中删除相应信息。',
            '演示账号信息只在申请完成页面显示一次，我们不会另行记录或打印密码。',
          ],
        },
      ],
      [
        { p: '我们不向其他公司或个人提供您的个人信息。仅在依照法律规定的程序（如搜查令）提出要求时例外。' },
      ],
      [
        { p: '本网站运行在 Cloudflare 的服务器上，申请内容和演示账号存储在 Cloudflare 的数据库（D1）中。为此我们按下表委托处理，这属于个人信息的跨境传输。' },
        {
          table: {
            head: ['项目', '内容'],
            rows: [
              ['接收方', 'Cloudflare, Inc.（美国公司）——101 Townsend St., San Francisco, CA 94107, USA · privacyquestions@cloudflare.com'],
              ['委托事项', '网站托管、数据库（D1）存储、网络传输、安全（如开启机器人验证，也包括该验证）'],
              ['传输国家与位置', '由美国公司运营的服务。数据库以亚太（APAC）位置提示创建——位置提示是 Cloudflare 在该区域内选择数据中心的参考值，并不保证位于特定国家。请求会经过就近的 Cloudflare 数据中心，可能位于韩国境外。'],
              ['传输时间与方式', '每次提交申请、登录或使用演示时，通过加密连接（HTTPS）传输并存储。'],
              ['传输项目', '第 2 条的全部项目'],
              ['保存期限', '与第 3 条相同；委托合同终止时删除。'],
              ['拒绝方法及后果', `如不希望跨境传输，请勿勾选申请表中的同意项。此时我们无法通过本网站受理演示账号或咨询申请，您可改为发送邮件至 ${email}。`],
            ],
          },
        },
        { p: '目前我们尚未使用自动邮件发送服务。若今后自动发送演示账号邮件，我们会将该服务商加入此表并更新本政策予以告知。' },
      ],
      [
        {
          ul: [
            '信息主体可随时要求查阅、更正、删除自己的个人信息，要求停止处理，或撤回同意。也可单独撤回接收新消息的同意。',
            `请发送邮件至 ${email}。为确认是您本人，请使用申请时填写的邮箱发送；如需进一步确认，我们可能会询问申请时的公司名称或注册号。`,
            '法定代理人或受托人也可代为提出，请一并附上委托书。',
            '收到要求后我们会在 10 天内处理并告知结果。如依法须拒绝，我们会告知理由。',
            '要求删除演示账号时，其演示使用记录将一并删除。',
          ],
        },
      ],
      [
        {
          ul: [
            '传输加密——本网站通过 HTTPS（加密连接）提供，演示登录 Cookie 仅通过 HTTPS 发送。',
            '密码——不保存原文，只保存 PBKDF2-SHA256 哈希值。密码仅在申请完成页面显示一次。',
            'IP 地址——不保存原文，只将其与密钥混合后的 SHA-256 哈希值用于统计尝试次数。',
            '演示登录——Cookie 经过签名，脚本无法读取（HttpOnly），且仅通过 HTTPS 发送（Secure）。每次使用都会与数据库核对，因此演示账号到期或被停用后立即失效。',
            '访问控制——没有查看已存信息的网页管理界面。只有获得 Cloudflare 账户权限的运营人员才能通过命令行工具访问数据库。',
            '尽量少留存——演示使用记录不含 IP、浏览器信息或输入的文字；新申请的内部通知只包含公司名称和申请内容（不含联系方式）。',
            '防止滥用——限制申请和登录的尝试次数，并过滤自动提交。',
            '自动销毁——超过保存期限的信息每天自动删除（第 4 条）。',
          ],
        },
      ],
      [
        {
          ul: [
            '只使用一个 Cookie——ss_demo：仅在登录演示时设置，仅用于保持登录状态（期限见第 3 条）。不使用广告或分析 Cookie、外部分析工具（如 Google Analytics）或广告像素，也不基于行为信息投放定向广告。',
            '浏览器存储（仅保存在本设备，不会发送给我们）——界面语言、主题（浅色或深色）、登录页面的公司代码、演示界面的显示设置（侧边栏、办公室视图、缩放）。',
            '从演示账号完成页面转到演示登录时，ID 和注册号会暂存在当前标签页的临时存储（sessionStorage）中，登录页面打开后立即删除。密码从不存入其中。',
            '拒绝方法——可在浏览器设置中阻止 Cookie 或清除网站数据。阻止 Cookie 后将无法登录演示。',
          ],
        },
      ],
      [
        { p: '个人信息保护负责人统筹个人信息处理事务，受理相关咨询、投诉、损害救济及查阅要求。' },
        {
          table: {
            head: ['项目', '内容'],
            rows: [
              ['个人信息保护负责人', `${owner}（代表）`],
              ['联系方式', email],
            ],
          },
        },
      ],
      [
        { p: '如因个人信息受侵害需要咨询或救济，可联系以下韩国机构。' },
        {
          table: {
            head: ['机构', '联系方式'],
            rows: [
              ['个人信息侵害举报中心（韩国互联网振兴院 KISA）', '118（韩国境内）· privacy.kisa.or.kr'],
              ['个人信息纠纷调解委员会', '1833-6972 · www.kopico.go.kr'],
              ['大检察厅', '1301（韩国境内）· www.spo.go.kr'],
              ['警察厅', '182（韩国境内）· ecrm.police.go.kr'],
            ],
          },
        },
      ],
      [
        { p: `本政策自 ${y} 年 ${m} 月 ${d} 日起施行。` },
        { p: '如有变更，我们会在施行 7 天前于本页面公告；涉及收集项目、目的、跨境传输等对您权利有重要影响的变更，将提前 30 天公告。如变更影响同意文本，我们会重新征得同意。' },
      ],
    ],
  );
}

const BUILD: Record<Locale, () => PolicyDoc> = { ko, en, 'zh-CN': zhCN };

export const policyFor = (locale: Locale): PolicyDoc => BUILD[locale]();
