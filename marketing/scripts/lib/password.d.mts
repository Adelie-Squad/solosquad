export const ITERATIONS: number;
export const DUMMY_HASH: string;
export function hashPassword(password: string, opts?: { iterations?: number; salt?: Uint8Array }): Promise<string>;
export function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean>;
export function newPassword(length?: number): string;
