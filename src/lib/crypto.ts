import crypto from 'node:crypto';

const ENCRYPTION_PREFIX = 'v1:';

export const SESSION_COOKIE_NAME = 'quackathon_sid';

const FALLBACK_PROCESS_SECRET = crypto.randomBytes(32).toString('hex');

function getHmacSecret(): string {
  return (
    process.env.SESSION_SECRET?.trim() ||
    process.env.SESSION_ENCRYPTION_KEY?.trim() ||
    process.env.PESU_OAUTH_CLIENT_SECRET?.trim() ||
    FALLBACK_PROCESS_SECRET
  );
}

function getEncryptionKey(): Buffer {
  const rawMaterial =
    process.env.SESSION_ENCRYPTION_KEY?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.PESU_OAUTH_CLIENT_SECRET?.trim() ||
    'quackathon-default-server-session-encryption-key-material';
  return crypto.createHash('sha256').update(rawMaterial, 'utf8').digest();
}

export function signSessionId(sessionId: string): string {
  const sig = crypto
    .createHmac('sha256', getHmacSecret())
    .update(sessionId)
    .digest('base64url');
  return `${sessionId}.${sig}`;
}

export function verifySignedSessionCookie(
  rawCookieVal: string | undefined
): string | null {
  if (!rawCookieVal || !rawCookieVal.includes('.')) return null;
  const [sessionId, sig] = rawCookieVal.split('.');
  if (!sessionId || !sig) return null;
  const expected = crypto
    .createHmac('sha256', getHmacSecret())
    .update(sessionId)
    .digest('base64url');
  if (sig.length !== expected.length) return null;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    ? sessionId
    : null;
}

export interface SessionCookieInspection {
  rawCount: number;
  verifiedSessionIds: string[];
  primarySessionId: string | null;
  cookieStatus: 'valid' | 'missing' | 'invalid_signature';
}

/**
 * Inspects all occurrences of `quackathon_sid` in a Cookie header without logging raw values.
 * Distinguishes missing cookies, invalid HMAC signatures, and valid signed session IDs.
 */
export function inspectSessionCookieHeader(
  cookieHeader: string | undefined,
  cookieName = SESSION_COOKIE_NAME
): SessionCookieInspection {
  if (!cookieHeader || !cookieHeader.trim()) {
    return {
      rawCount: 0,
      verifiedSessionIds: [],
      primarySessionId: null,
      cookieStatus: 'missing',
    };
  }

  let rawCount = 0;
  const verifiedSessionIds: string[] = [];

  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (key !== cookieName) continue;
    const rawVal = part.slice(idx + 1).trim();
    if (!rawVal) continue;
    rawCount += 1;
    let decoded = rawVal;
    try {
      decoded = decodeURIComponent(rawVal);
    } catch {
      // use rawVal if decodeURIComponent fails
    }
    const verified = verifySignedSessionCookie(decoded);
    if (verified && !verifiedSessionIds.includes(verified)) {
      verifiedSessionIds.push(verified);
    }
  }

  if (rawCount === 0) {
    return {
      rawCount: 0,
      verifiedSessionIds: [],
      primarySessionId: null,
      cookieStatus: 'missing',
    };
  }

  if (verifiedSessionIds.length === 0) {
    return {
      rawCount,
      verifiedSessionIds: [],
      primarySessionId: null,
      cookieStatus: 'invalid_signature',
    };
  }

  return {
    rawCount,
    verifiedSessionIds,
    primarySessionId: verifiedSessionIds[0],
    cookieStatus: 'valid',
  };
}

/**
 * Hashes an opaque session lookup token using SHA-256 so plaintext lookup tokens
 * are never stored in the database.
 */
export function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken.trim(), 'utf8').digest('hex');
}

/**
 * Encrypts sensitive provider tokens (access_token / refresh_token / PKCE code_verifier)
 * using AES-256-GCM before persisting them to PostgreSQL.
 */
export function encryptTokenAtRest(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  if (plaintext.startsWith(ENCRYPTION_PREFIX)) {
    return plaintext;
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTION_PREFIX}${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

/**
 * Decrypts AES-256-GCM encrypted tokens retrieved from PostgreSQL.
 */
export function decryptTokenAtRest(payload: string | null | undefined): string | null {
  if (!payload) return null;
  if (!payload.startsWith(ENCRYPTION_PREFIX)) {
    return payload;
  }
  const body = payload.slice(ENCRYPTION_PREFIX.length);
  const parts = body.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted token payload');
  }
  const [ivB64, tagB64, dataB64] = parts;
  const key = getEncryptionKey();
  const iv = Buffer.from(ivB64, 'base64url');
  const authTag = Buffer.from(tagB64, 'base64url');
  const encrypted = Buffer.from(dataB64, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
