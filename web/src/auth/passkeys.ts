// Passkeys in the browser (decision 46 W3): the engine makes the options and checks the
// answer; the browser only asks the authenticator. Binary fields travel as base64url.
import { api } from '../api/client';
import type { Me, Passkey, PasskeyAdded, PasskeyOptions } from '../api/types.gen';
import { base64urlToBytes, bytesToBase64url } from '../lib/base64url';

type Json = Record<string, unknown>;

export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined' && !!navigator.credentials;
}

/** The login screen offers a passkey only when the office can (public_url set — /api/health),
 * the browser can, and the engine has not refused it (409) in this visit. */
export function showPasskeyButton(opts: { officeAllows: boolean | undefined; browserSupports: boolean; refused: boolean }): boolean {
  return !!opts.officeAllows && opts.browserSupports && !opts.refused;
}

const descriptors = (list: unknown) =>
  Array.isArray(list)
    ? list.map((d: Json) => ({ ...d, id: base64urlToBytes(String(d.id)) }) as PublicKeyCredentialDescriptor)
    : undefined;

export function toCreationOptions(o: Json): PublicKeyCredentialCreationOptions {
  const user = o.user as Json;
  return {
    ...(o as unknown as PublicKeyCredentialCreationOptions),
    challenge: base64urlToBytes(String(o.challenge)),
    user: { ...(user as unknown as PublicKeyCredentialUserEntity), id: base64urlToBytes(String(user.id)) },
    excludeCredentials: descriptors(o.excludeCredentials),
  };
}

export function toRequestOptions(o: Json): PublicKeyCredentialRequestOptions {
  return {
    ...(o as unknown as PublicKeyCredentialRequestOptions),
    challenge: base64urlToBytes(String(o.challenge)),
    allowCredentials: descriptors(o.allowCredentials),
  };
}

/** A credential from create()/get() → the JSON the engine (py_webauthn) reads. */
export function credentialToJson(cred: PublicKeyCredential): Json {
  const r = cred.response as AuthenticatorAttestationResponse & AuthenticatorAssertionResponse;
  const response: Json = { clientDataJSON: bytesToBase64url(r.clientDataJSON) };
  if ('attestationObject' in r && r.attestationObject) {
    response.attestationObject = bytesToBase64url(r.attestationObject);
    if (typeof r.getTransports === 'function') response.transports = r.getTransports();
  } else {
    response.authenticatorData = bytesToBase64url(r.authenticatorData);
    response.signature = bytesToBase64url(r.signature);
    if (r.userHandle) response.userHandle = bytesToBase64url(r.userHandle);
  }
  return {
    id: cred.id,
    rawId: bytesToBase64url(cred.rawId),
    type: cred.type,
    response,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
  };
}

/** Add a passkey to the logged-in account (also finishes first-login enrolment). */
export async function registerPasskey(name: string): Promise<Passkey[]> {
  const begin = await api.post<PasskeyOptions>('/auth/passkey/register/begin');
  const cred = (await navigator.credentials.create({ publicKey: toCreationOptions(begin.options) })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  const done = await api.post<PasskeyAdded>('/auth/passkey/register/finish', {
    challenge_id: begin.challenge_id,
    credential: credentialToJson(cred),
    name,
  });
  return done.passkeys;
}

/** Sign in with a discoverable passkey — no username asked. */
export async function loginWithPasskey(): Promise<Me> {
  const begin = await api.post<PasskeyOptions>('/auth/passkey/login/begin', {});
  const cred = (await navigator.credentials.get({ publicKey: toRequestOptions(begin.options) })) as PublicKeyCredential | null;
  if (!cred) throw new Error('cancelled');
  return api.post<Me>('/auth/passkey/login/finish', { challenge_id: begin.challenge_id, credential: credentialToJson(cred) });
}

/** A name for a new passkey that tells devices apart in the list. */
export function defaultPasskeyName(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  if (/iPhone|iPad/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Passkey';
}
