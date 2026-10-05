import 'server-only';
import CryptoJS from 'crypto-js';

export interface GhlIdentity {
  locationId: string;
  userId: string;
  email: string | null;
  name?: string;
  ghlRole?: 'admin' | 'user';
}

/** HighLevel Marketplace user context; secret and decryption stay server-side. */
export function decryptGhlIdentity(
  encryptedData: unknown,
  policy: { secret?: string; companyId?: string; requestedLocation?: string },
): GhlIdentity | null {
  if (!policy.secret || !policy.companyId || typeof encryptedData !== 'string' ||
      encryptedData.length > 16_384 || !encryptedData.startsWith('U2FsdGVkX1')) return null;
  try {
    const value: unknown = JSON.parse(
      CryptoJS.AES.decrypt(encryptedData, policy.secret).toString(CryptoJS.enc.Utf8),
    );
    if (typeof value !== 'object' || value === null) return null;
    const data = value as Record<string, unknown>;
    if (data.companyId !== policy.companyId ||
        typeof data.userId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(data.userId) ||
        typeof data.activeLocation !== 'string' || !/^[A-Za-z0-9]{15,40}$/.test(data.activeLocation) ||
        (data.role !== 'admin' && data.role !== 'user')) return null;
    if (policy.requestedLocation && policy.requestedLocation !== data.activeLocation) return null;
    return {
      locationId: data.activeLocation,
      userId: data.userId,
      email: typeof data.email === 'string' ? data.email.slice(0, 254) : null,
      name: typeof data.userName === 'string' ? data.userName.slice(0, 120) : undefined,
      ghlRole: data.role,
    };
  } catch {
    return null;
  }
}
