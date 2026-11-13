// The demo account mail (2026-11-13): the owner wants the account sent by email too, later. This is
// the hook the request handler already calls (after the account is issued, in the background) —
// it sends nothing yet, so the completion screen does not promise a mail. When a provider is
// chosen, send here: to the request's email, in its language, with the number, ID, password and
// end; never log the password.
import type { Env } from './env';
import type { IssuedDemo } from './demo';

export interface DemoMail {
  to: string;
  name: string;
  locale: string;
  account: IssuedDemo;
}

/** No-op until a mail provider is set up. Must never throw into the request. */
export async function sendDemoMail(_env: Env, _mail: DemoMail): Promise<void> {
  return;
}
