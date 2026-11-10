// The org chart's connector lines as one decorative SVG under the chart's nodes (orgGeometry.ts draws them).
import type { OrgLine } from './orgGeometry';

export function OrgLines({ lines, size }: { lines: OrgLine[]; size: { w: number; h: number } }) {
  return (
    <svg className="org-lines" aria-hidden="true" focusable="false" width={size.w || undefined} height={size.h || undefined}>
      {lines.map((l, i) => (
        <path key={i} d={l.d} data-line={l.kind} />
      ))}
    </svg>
  );
}
