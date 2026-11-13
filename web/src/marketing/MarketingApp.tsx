// The marketing site's pages (decision 62 — the landing and the logins are for outside visitors):
// `/` the landing · `/login` the login router (company code + ID → that company's server) ·
// `/login/help` its neutral page · `/demo` the demo login · `/privacy` the privacy policy (`/policy`
// redirects there — the user keeps the address /privacy, 2026-11-14). No app shell, no engine API. Company servers do not serve
// these: their `/` is their own login (App.tsx, C62).
import { Navigate, Route, Routes } from 'react-router-dom';
import { Landing } from '../landing/Landing';
import { DemoLogin } from './DemoLogin';
import { InquiryProvider } from './Inquiry';
import { LoginHelp, LoginRouter } from './LoginRouter';
import './messages';
import { SITE } from './messages/site';
import { Policy } from './Policy';

export function MarketingApp() {
  return (
    <InquiryProvider>
      <Routes>
        <Route index element={<Landing />} />
        <Route path="login" element={<LoginRouter />} />
        <Route path="login/help" element={<LoginHelp />} />
        <Route path="demo" element={<DemoLogin />} />
        <Route path="privacy" element={<Policy />} />
        <Route path="policy" element={<Navigate to={SITE.policyPath} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </InquiryProvider>
  );
}
