// Server error codes → the person's words (DESIGN.md `## 문구`: server error text is shown
// through translation keys, never as the server's English or as a code).
// The list of codes is the contract (`ErrorCode` in types.gen.ts, from
// python/src/solosquad/web_api/errors.py); the record below must name every one of them, so
// a code added on the server fails `npm run typecheck` until it has its words here.
import type { MessageKey, Translate, Vars } from '../i18n';
import { ApiError } from './client';
import type { ErrorCode } from './types.gen';

export const ERROR_KEYS: Record<ErrorCode, MessageKey> = {
  invalid_request: 'error.invalid_request',
  unauthorized: 'error.unauthorized',
  forbidden: 'error.forbidden',
  not_found: 'error.not_found',
  method_not_allowed: 'error.method_not_allowed',
  conflict: 'error.conflict',
  too_large: 'error.too_large',
  unprocessable: 'error.unprocessable',
  server_error: 'error.server_error',
  network_blocked: 'error.network_blocked',
  workspace_network_blocked: 'error.workspace_network_blocked',
  csrf_invalid: 'error.csrf_invalid',
  enrol_required: 'error.enrol_required',
  role_forbidden: 'error.role_forbidden',
  workspace_not_started: 'error.workspace_not_started',
  org_not_running: 'error.org_not_running',
  org_records_unavailable: 'error.org_records_unavailable',
  feature_disabled: 'error.feature_disabled',
  login_failed: 'error.login_failed',
  login_throttled: 'error.login_throttled',
  otp_required: 'error.otp_required',
  otp_invalid: 'error.otp_invalid',
  account_required: 'error.account_required',
  passkeys_unavailable: 'error.passkeys_unavailable',
  passkey_expired: 'error.passkey_expired',
  passkey_rejected: 'error.passkey_rejected',
  passkey_not_recognised: 'error.passkey_not_recognised',
  username_invalid: 'error.username_invalid',
  username_taken: 'error.username_taken',
  password_too_short: 'error.password_too_short',
  last_owner: 'error.last_owner',
  assignment_invalid: 'error.assignment_invalid',
  assignment_duplicate: 'error.assignment_duplicate',
  assignment_unknown_scope: 'error.assignment_unknown_scope',
  user_fields_moved: 'error.user_fields_moved',
  teams_invalid: 'error.teams_invalid',
  locale_invalid: 'error.locale_invalid',
  access_lockout: 'error.access_lockout',
  network_invalid: 'error.network_invalid',
  profile_invalid: 'error.profile_invalid',
  snapshot_invalid: 'error.snapshot_invalid',
  snapshot_keys_required: 'error.snapshot_keys_required',
  snapshot_unavailable: 'error.snapshot_unavailable',
  snapshot_failed: 'error.snapshot_failed',
  secret_store_missing: 'error.secret_store_missing',
  approval_policy_invalid: 'error.approval_policy_invalid',
  unclassified_owner_only: 'error.unclassified_owner_only',
  approval_needs_owner: 'error.approval_needs_owner',
  approval_needs_team: 'error.approval_needs_team',
  connection_id_required: 'error.connection_id_required',
  connection_exists: 'error.connection_exists',
  entity_required: 'error.entity_required',
  connection_ineligible_entity: 'error.connection_ineligible_entity',
  connection_ineligible_server: 'error.connection_ineligible_server',
  workflow_input_invalid: 'error.workflow_input_invalid',
  upload_type: 'error.upload_type',
  upload_empty: 'error.upload_empty',
  upload_too_large: 'error.upload_too_large',
};

export function isErrorCode(code: unknown): code is ErrorCode {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_KEYS, code);
}

/** The code of a failed request, or null when it is not one the web knows. */
export function errorCode(err: unknown): ErrorCode | null {
  return err instanceof ApiError && isErrorCode(err.code) ? err.code : null;
}

/** The words for a failed request. A code the web does not know (a newer server) and an
 * answer without one read as the generic sentence — the server's English never shows. */
export function errorKey(err: unknown): MessageKey {
  const code = errorCode(err);
  if (code) return ERROR_KEYS[code];
  return err instanceof ApiError ? 'error.unknown' : 'common.failed';
}

/** `errorKey` with the server's `params` in the text's placeholders. */
export function errorText(err: unknown, t: Translate): string {
  const vars: Vars = err instanceof ApiError && errorCode(err) ? err.params : {};
  return t(errorKey(err), vars);
}
