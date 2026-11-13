export type CompanyNoKind = 'business' | 'corporate' | 'foreign';
export const COMPANY_NO_KINDS: readonly CompanyNoKind[];
export const KOREAN_KINDS: readonly ('business' | 'corporate')[];
export const LENGTH: { business: number; corporate: number };
export const FOREIGN_MIN: number;
export const MAX_DIGITS: number;
export function digitsOf(raw: unknown): string;
export function businessNoOk(digits: string): boolean;
export function corporateNoOk(digits: string): boolean;
export function formatCompanyNo(digits: string, kind: string | null | undefined): string;
export function formatByLength(digits: string): string;
export function maxDigits(kind: string | null | undefined): number;
export type CompanyNoError = 'required' | 'invalid' | 'length' | 'check';
export function checkCompanyNo(
  raw: unknown,
  kind: string | null | undefined,
  opts?: { internal?: boolean },
): { ok: true; digits: string; kind: CompanyNoKind } | { ok: false; error: CompanyNoError };
export function kindByLength(digits: string): 'business' | 'corporate';
export function displayCompanyNo(digits: string | null | undefined, kind: string | null | undefined): string;
