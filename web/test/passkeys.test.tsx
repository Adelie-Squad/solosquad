import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { credentialToJson, showPasskeyButton, toCreationOptions, toRequestOptions } from '../src/auth/passkeys';
import { Login } from '../src/auth/Login';
import { base64urlToBytes, bytesToBase64url } from '../src/lib/base64url';
import { renderWith } from './helpers';

const bytes = (...n: number[]) => new Uint8Array(n).buffer;

describe('base64url', () => {
  it('matches RFC 4648 vectors without padding', () => {
    const enc = (s: string) => bytesToBase64url(new TextEncoder().encode(s));
    expect(enc('')).toBe('');
    expect(enc('f')).toBe('Zg');
    expect(enc('fo')).toBe('Zm8');
    expect(enc('foo')).toBe('Zm9v');
    expect(enc('foobar')).toBe('Zm9vYmFy');
  });

  it('uses the URL alphabet and round-trips every byte', () => {
    expect(bytesToBase64url(bytes(0xfb, 0xff))).toBe('-_8');
    const all = new Uint8Array(256).map((_, i) => i);
    expect(new Uint8Array(base64urlToBytes(bytesToBase64url(all)))).toEqual(all);
    expect(new Uint8Array(base64urlToBytes('-_8'))).toEqual(new Uint8Array([0xfb, 0xff]));
  });

  it('accepts a view into a larger buffer and refuses non-base64url text', () => {
    const big = new Uint8Array([9, 1, 2, 3, 9]);
    expect(bytesToBase64url(big.subarray(1, 4))).toBe(bytesToBase64url(bytes(1, 2, 3)));
    expect(() => base64urlToBytes('a+b/')).toThrow();
  });
});

describe('WebAuthn JSON ↔ browser objects', () => {
  it('turns the engine’s options into buffers', () => {
    const create = toCreationOptions({
      challenge: 'AQID',
      rp: { id: 'office.example', name: 'SoloSquad' },
      user: { id: 'dS0x', name: 'kim', displayName: 'Kim' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      excludeCredentials: [{ type: 'public-key', id: 'BAU' }],
    });
    expect(new Uint8Array(create.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new TextDecoder().decode(create.user.id as ArrayBuffer)).toBe('u-1');
    expect(new Uint8Array(create.excludeCredentials![0].id as ArrayBuffer)).toEqual(new Uint8Array([4, 5]));
    const get = toRequestOptions({ challenge: 'AQID', rpId: 'office.example' });
    expect(get.allowCredentials).toBeUndefined();
  });

  it('serialises an assertion the way the engine reads it', () => {
    const cred = {
      id: 'Y3JlZA',
      rawId: bytes(99, 114, 101, 100),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      response: { clientDataJSON: bytes(1), authenticatorData: bytes(2), signature: bytes(3), userHandle: bytes(4) },
      getClientExtensionResults: () => ({}),
    } as unknown as PublicKeyCredential;
    expect(credentialToJson(cred)).toEqual({
      id: 'Y3JlZA',
      rawId: 'Y3JlZA',
      type: 'public-key',
      response: { clientDataJSON: 'AQ', authenticatorData: 'Ag', signature: 'Aw', userHandle: 'BA' },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    });
  });
});

describe('passkey button on the login screen', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('is shown only when the office, the browser and the engine all allow it', () => {
    expect(showPasskeyButton({ officeAllows: true, browserSupports: true, refused: false })).toBe(true);
    expect(showPasskeyButton({ officeAllows: false, browserSupports: true, refused: false })).toBe(false);
    expect(showPasskeyButton({ officeAllows: undefined, browserSupports: true, refused: false })).toBe(false);
    expect(showPasskeyButton({ officeAllows: true, browserSupports: false, refused: false })).toBe(false);
    expect(showPasskeyButton({ officeAllows: true, browserSupports: true, refused: true })).toBe(false);
  });

  function serve(passkeys: boolean, begin: { status: number; body: unknown }) {
    const fetch = vi.fn(async (url: string) => {
      if (url === '/api/health') return new Response(JSON.stringify({ ok: true, passkeys }), { status: 200 });
      if (url === '/api/auth/passkey/login/begin') return new Response(JSON.stringify(begin.body), { status: begin.status });
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('PublicKeyCredential', function PublicKeyCredential() {});
    Object.defineProperty(navigator, 'credentials', { value: { get: vi.fn(), create: vi.fn() }, configurable: true });
    return fetch;
  }

  it('appears when /api/health says passkeys are possible', async () => {
    serve(true, { status: 200, body: {} });
    renderWith(<Login />, 'en');
    await waitFor(() => expect(screen.getByTestId('passkey-login')).toBeTruthy());
  });

  it('stays hidden without public_url', async () => {
    const fetch = serve(false, { status: 409, body: { error: 'passkeys need the office public_url', code: 'passkeys_unavailable', params: {} } });
    renderWith(<Login />, 'en');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/health', expect.anything()));
    expect(screen.queryByTestId('passkey-login')).toBeNull();
  });

  it('hides itself when the engine answers passkeys_unavailable', async () => {
    serve(true, { status: 409, body: { error: 'passkeys need the office public_url', code: 'passkeys_unavailable', params: {} } });
    renderWith(<Login />, 'en');
    const button = await waitFor(() => screen.getByTestId('passkey-login'));
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByTestId('passkey-login')).toBeNull());
  });
});
