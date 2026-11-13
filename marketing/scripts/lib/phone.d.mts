export const PHONE_MAX: { kr: number; other: number };
export const PHONE_MIN_OTHER: number;
export function phoneDigits(raw: unknown): string;
export function phoneMax(country: string | null | undefined): number;
export function formatPhone(raw: string, country: string | null | undefined): string;
export function checkPhone(raw: unknown, country: string | null | undefined): { ok: true; digits: string } | { ok: false; error: 'required' | 'invalid' };
