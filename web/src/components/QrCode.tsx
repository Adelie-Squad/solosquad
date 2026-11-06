import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** A QR code drawn as SVG rectangles — no data: URL, so it passes the engine's CSP. */
export function QrCode({ value, size = 200, label }: { value: string; size?: number; label: string }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const n = qr.getModuleCount();
    const dark: [number, number][] = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark.push([c, r]);
    return { n, dark };
  }, [value]);
  const quiet = 2;
  const box = cells.n + quiet * 2;
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${box} ${box}`}
      shapeRendering="crispEdges"
    >
      <rect width={box} height={box} style={{ fill: 'var(--qr-light)' }} />
      <path
        style={{ fill: 'var(--qr-dark)' }}
        d={cells.dark.map(([x, y]) => `M${x + quiet} ${y + quiet}h1v1h-1z`).join('')}
      />
    </svg>
  );
}
