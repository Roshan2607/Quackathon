import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import {
  getUserAndProfileByUid,
  getValidOAuthSessionByInitiatingSessionId,
  getValidOAuthSessionRecord,
  upsertUserAndProfile,
} from '../db/repository.ts';
import {
  SESSION_COOKIE_NAME,
  verifySignedSessionCookie,
} from '../lib/crypto.ts';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    name?: string;
    verificationStatus: 'verified_pesu_oidc' | 'pilot_invite' | 'unverified';
    isAdmin?: boolean;
    authSource: 'firebase' | 'pesu_oauth';
    pesuSessionToken?: string;
  };
}

let customFirebaseVerifierForTest:
  | ((token: string) => Promise<{ uid: string; email?: string; name?: string }>)
  | null = null;

export function setFirebaseTokenVerifierForTest(
  fn: ((token: string) => Promise<{ uid: string; email?: string; name?: string }>) | null
) {
  customFirebaseVerifierForTest = fn;
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      out[k] = v;
    }
  }
  return out;
}

/**
 * Resolves the authenticated user from either:
 * 1. `Authorization: Bearer pesu_<session_token>`, `quackathon_oauth_token` cookie,
 *    or signed `quackathon_oauth_sid` cookie correlated with a persistent PESU OAuth2 session
 * 2. `Authorization: Bearer <firebase_id_token>` (Firebase Auth Google Sign-In)
 */
export async function resolveOptionalUser(
  req: AuthenticatedRequest
): Promise<AuthenticatedRequest['user'] | null> {
  const authHeader = req.headers.authorization;
  const cookies = parseCookieHeader(req.headers.cookie);

  let rawBearer = '';
  if (authHeader && authHeader.startsWith('Bearer ')) {
    rawBearer = authHeader.slice('Bearer '.length).trim();
  }

  const pesuToken =
    rawBearer.startsWith('pesu_')
      ? rawBearer
      : cookies['quackathon_oauth_token'] || '';

  const signedSid = verifySignedSessionCookie(cookies[SESSION_COOKIE_NAME]);

  if (pesuToken || signedSid) {
    try {
      const oauthSess = pesuToken
        ? await getValidOAuthSessionRecord(pesuToken)
        : signedSid
        ? await getValidOAuthSessionByInitiatingSessionId(signedSid)
        : null;
      if (oauthSess) {
        const record = await getUserAndProfileByUid(oauthSess.uid);
        if (record) {
          const authUser: AuthenticatedRequest['user'] = {
            uid: record.user.uid,
            email: undefined,
            name: record.user.displayName,
            verificationStatus: record.user.verificationStatus,
            isAdmin: Boolean(record.user.isAdmin),
            authSource: 'pesu_oauth',
            pesuSessionToken: pesuToken || signedSid || undefined,
          };
          req.user = authUser;
          return authUser;
        }
      }
    } catch (error) {
      console.error('Error verifying PESU OAuth session token:', error);
    }
  }

  if (rawBearer && !rawBearer.startsWith('pesu_')) {
    try {
      const decoded = customFirebaseVerifierForTest
        ? await customFirebaseVerifierForTest(rawBearer)
        : await adminAuth.verifyIdToken(rawBearer);
      const email = decoded.email ?? `${decoded.uid}@external.auth`;
      const displayName =
        decoded.name ?? email.split('@')[0] ?? 'Authenticated User';

      // IMPORTANT: Firebase-authenticated users are NOT granted PESU-verified status
      // based on email, domain, or client claims. They remain 'unverified' unless
      // they have already completed a trusted PESU OIDC verification flow.
      const synced = await upsertUserAndProfile({
        uid: decoded.uid,
        email,
        displayName,
        pesuOidcSub: 'UNVERIFIED',
        verificationStatus: 'unverified',
      });
      const authUser: AuthenticatedRequest['user'] = {
        uid: synced.user.uid,
        email,
        name: synced.user.displayName,
        verificationStatus: synced.user.verificationStatus,
        isAdmin: Boolean(synced.user.isAdmin),
        authSource: 'firebase',
      };
      req.user = authUser;
      return authUser;
    } catch (error) {
      console.error('Error verifying Firebase ID token:', error);
    }
  }

  return null;
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const user = await resolveOptionalUser(req);
  if (!user) {
    res.status(401).json({
      ok: false,
      errorCategory: 'AUTH_ERROR',
      error: 'Authentication required. Please sign in with PESU OAuth2 or Google.',
      userMessage: 'Please sign in with PESU OAuth2 or Google to perform this action.',
    });
    return;
  }
  next();
}

export async function requireVerifiedStudent(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const user = await resolveOptionalUser(req);
  if (!user) {
    res.status(401).json({
      ok: false,
      errorCategory: 'AUTH_ERROR',
      error: 'Authentication required.',
      userMessage: 'Please sign in with PESU OAuth2 to perform this action.',
    });
    return;
  }
  if (user.verificationStatus !== 'verified_pesu_oidc' && !user.isAdmin) {
    res.status(403).json({
      ok: false,
      errorCategory: 'STUDENT_VERIFICATION_REQUIRED',
      error: 'Forbidden: PESU-verified student identity required.',
      userMessage:
        'This action requires a verified PESU student identity. Please verify via PESU OAuth2.',
    });
    return;
  }
  next();
}

export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const user = await resolveOptionalUser(req);
  if (!user) {
    res.status(401).json({
      ok: false,
      errorCategory: 'AUTH_ERROR',
      error: 'Authentication required for admin access.',
      userMessage: 'Please sign in to access moderator tools.',
    });
    return;
  }
  if (!user.isAdmin) {
    res.status(403).json({
      ok: false,
      errorCategory: 'AUTH_ERROR',
      error: 'Forbidden: Moderator privileges required.',
      userMessage: 'Your account does not have moderator privileges.',
    });
    return;
  }
  next();
}
