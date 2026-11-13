// The marketing site's pages (decision 62 — the landing and the logins are for outside visitors):
// `/` the landing · `/login` the login router (company code + ID → that company's server) ·
// `/login/help` its neutral page · `/demo` the demo login · `/policy` the privacy policy (`/privacy`,
// its old address, redirects there). No app shell, no engine API. Company servers do not serve
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
        <Route path="policy" element={<Policy />} />
        <Route path="privacy" element={<Navigate to={SITE.policyPath} replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </InquiryProvider>
  );
}
