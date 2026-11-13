export const WORDS: Readonly<Record<string, string>>;
export const FALLBACK_WORD: string;
export function wordFor(email: string): string;
export function demoPassword(email: string, phone: string): string | null;
