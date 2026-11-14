import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import {
  getUserAndProfileByUid,
  getValidOAuthSessionRecord,
  upsertUserAndProfile,
} from '../db/repository.ts';

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    name?: string;
    isAdmin?: boolean;
    authSource: 'firebase' | 'pesu_oauth';
    pesuSessionToken?: string;
  };
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
 * 1. `Authorization: Bearer pesu_<session_token>` or `quackathon_oauth_token` cookie (PESU OAuth2 persistent session)
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

  if (pesuToken) {
    try {
      const oauthSess = await getValidOAuthSessionRecord(pesuToken);
      if (oauthSess) {
        const record = await getUserAndProfileByUid(oauthSess.uid);
        if (record) {
          const authUser: AuthenticatedRequest['user'] = {
            uid: record.user.uid,
            email: undefined,
            name: record.user.displayName,
            isAdmin: Boolean(record.user.isAdmin),
            authSource: 'pesu_oauth',
            pesuSessionToken: pesuToken,
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
      const decoded = await adminAuth.verifyIdToken(rawBearer);
      const email = decoded.email ?? `${decoded.uid}@pesu.pes.edu`;
      const displayName =
        decoded.name ?? email.split('@')[0] ?? 'PES Student';
      const synced = await upsertUserAndProfile({
        uid: decoded.uid,
        email,
        displayName,
        pesuOidcSub: `firebase_${decoded.uid}`,
        verificationStatus: 'verified_pesu_oidc',
      });
      const authUser: AuthenticatedRequest['user'] = {
        uid: synced.user.uid,
        email,
        name: synced.user.displayName,
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
