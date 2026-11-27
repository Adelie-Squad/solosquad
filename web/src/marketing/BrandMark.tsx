// The public brand's mark on the marketing site (2026-11-27 — user: "랜딩페이지에서 solosquad 이름을 agenxy로
// 바꿔줘"): the product is SoloSquad inside (the app, the engine, the CLI); the site the public sees is
// agenxy, always lower case. Until the logo is chosen it is a text wordmark in the place's own style;
// the logo SVG drops in here, once, for the landing's top bar, the footer and the privacy page.
import { SITE } from './messages/site';

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`brand-mark ${className}`.trim()} data-testid="brand-mark">
      {SITE.brand}
    </span>
  );
}
