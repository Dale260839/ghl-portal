import 'server-only';
import CryptoJS from 'crypto-js';

export interface GhlIdentity {
  locationId: string;
  userId: string;
  email: string | null;
  name?: string;
  ghlRole?: 'admin' | 'user';
}

/**
 * Why a user context was refused.
 *
 * ---------------------------------------------------------------------------
 * THE BROWSER IS TOLD NOTHING. THE OPERATOR IS TOLD EVERYTHING.
 *
 * Every refusal here looks identical from the outside — one sentence, no
 * detail — because distinguishing them for a caller hands an attacker a
 * narrowing game: wrong secret, wrong agency, wrong shape, each answered
 * separately, is an oracle.
 *
 * It also made a real misconfiguration undebuggable. On 5 October 2026 a
 * correct iframe handshake was refused in production and there was no way to
 * tell whether the shared secret or the agency binding was wrong — two
 * variables, one indistinguishable symptom, and no log line either. The reason
 * goes to the server log, where only the operator can read it.
 *
 * `sawCompanyId` is the agency id the payload carried. It is not a secret: it
 * is the operator's own agency, already sitting in `hub_ghl_agency`. Logging it
 * next to the configured one turns "it doesn't work" into a diff.
 * ---------------------------------------------------------------------------
 */
export type IdentityRefusal =
  /** No shared secret or no agency binding. Nothing to verify against. */
  | 'not_configured'
  /** Not a CryptoJS envelope at all — wrong field, wrong app, or nothing sent. */
  | 'malformed_envelope'
  /** The envelope would not open. In practice: the shared secret is wrong. */
  | 'undecryptable'
  /** It opened, and belongs to a different agency. */
  | 'wrong_company'
  /** It opened and is ours, but is not a user context we recognise. */
  | 'unexpected_shape'
  /** The URL claimed one sub-account and the payload proved another. */
  | 'location_mismatch';

export type IdentityReading =
  | { ok: true; identity: GhlIdentity }
  | { ok: false; reason: IdentityRefusal; sawCompanyId?: string };

export interface IdentityPolicy {
  secret?: string;
  companyId?: string;
  /** Optional. Absent on a Custom Page, which cannot carry one — see entry-mode.ts. */
  requestedLocation?: string;
}

/** HighLevel Marketplace user context; secret and decryption stay server-side. */
export function readGhlIdentity(encryptedData: unknown, policy: IdentityPolicy): IdentityReading {
  if (!policy.secret || !policy.companyId) return { ok: false, reason: 'not_configured' };

  if (typeof encryptedData !== 'string' || encryptedData.length > 16_384 ||
      !encryptedData.startsWith('U2FsdGVkX1')) {
    return { ok: false, reason: 'malformed_envelope' };
  }

  let data: Record<string, unknown>;
  try {
    // A wrong secret does not decrypt to something else — it decrypts to
    // rubbish, and CryptoJS throws on the UTF-8 decode. That throw IS the
    // signal, which is why it is caught here and nowhere wider.
    const value: unknown = JSON.parse(
      CryptoJS.AES.decrypt(encryptedData, policy.secret).toString(CryptoJS.enc.Utf8),
    );
    if (typeof value !== 'object' || value === null) return { ok: false, reason: 'undecryptable' };
    data = value as Record<string, unknown>;
  } catch {
    return { ok: false, reason: 'undecryptable' };
  }

  if (data.companyId !== policy.companyId) {
    return {
      ok: false,
      reason: 'wrong_company',
      // Only when it is a string, and only a bounded amount of it. A payload
      // that decrypted is not automatically a payload worth echoing whole.
      ...(typeof data.companyId === 'string' ? { sawCompanyId: data.companyId.slice(0, 64) } : {}),
    };
  }

  if (typeof data.userId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(data.userId) ||
      typeof data.activeLocation !== 'string' || !/^[A-Za-z0-9]{15,40}$/.test(data.activeLocation) ||
      (data.role !== 'admin' && data.role !== 'user')) {
    return { ok: false, reason: 'unexpected_shape' };
  }

  if (policy.requestedLocation && policy.requestedLocation !== data.activeLocation) {
    return { ok: false, reason: 'location_mismatch' };
  }

  return {
    ok: true,
    identity: {
      locationId: data.activeLocation,
      userId: data.userId,
      email: typeof data.email === 'string' ? data.email.slice(0, 254) : null,
      name: typeof data.userName === 'string' ? data.userName.slice(0, 120) : undefined,
      ghlRole: data.role,
    },
  };
}

/** The same decision, for callers that only need the answer. */
export function decryptGhlIdentity(
  encryptedData: unknown,
  policy: IdentityPolicy,
): GhlIdentity | null {
  const reading = readGhlIdentity(encryptedData, policy);
  return reading.ok ? reading.identity : null;
}
