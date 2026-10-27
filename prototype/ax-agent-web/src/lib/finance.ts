import type { MonthlyStatement } from '../data/dummy';

export function expenses(s: MonthlyStatement): number {
  return s.cogs + s.logistics + s.ads + s.payroll + s.rent + s.other;
}

export function netIncome(s: MonthlyStatement): number {
  return s.revenue - expenses(s);
}

/** 순이익 ÷ 매출, 0–100 */
export function marginRate(s: MonthlyStatement): number {
  return s.revenue === 0 ? 0 : (netIncome(s) / s.revenue) * 100;
}

/** 손익표 행 정의 — 화면 표와 엑셀 내보내기가 같은 순서를 쓴다 */
export const statementRows: { label: string; value: (s: MonthlyStatement) => number; total?: boolean }[] = [
  { label: '매출', value: (s) => s.revenue },
  { label: '상품 원가', value: (s) => s.cogs },
  { label: '물류 · 관세', value: (s) => s.logistics },
  { label: '광고비', value: (s) => s.ads },
  { label: '인건비', value: (s) => s.payroll },
  { label: '창고 임대료', value: (s) => s.rent },
  { label: '기타 비용', value: (s) => s.other },
  { label: '지출 합계', value: expenses, total: true },
  { label: '순이익', value: netIncome, total: true },
];

/** 엑셀에서 바로 열리는 CSV — 한글이 깨지지 않게 BOM 을 붙인다 */
export function downloadStatementCsv(statements: MonthlyStatement[], fileName: string) {
  const header = ['항목', ...statements.map((s) => (s.partial ? `${s.month}(진행 중)` : s.month))];
  const rows = [
    ...statementRows.map((r) => [r.label, ...statements.map((s) => String(r.value(s)))]),
    ['마진율(%)', ...statements.map((s) => marginRate(s).toFixed(1))],
  ];
  const csv = [header, ...rows].map((cols) => cols.join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}
