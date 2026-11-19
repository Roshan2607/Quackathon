import { and, desc, eq, lt, or } from 'drizzle-orm';
import { db } from './index.ts';
import * as schema from './schema.ts';
import {
  decryptTokenAtRest,
  encryptTokenAtRest,
  hashSessionToken,
} from '../lib/crypto.ts';
import {
  CampusType,
  CommitmentLevel,
  Conversation,
  EventCandidate,
  EventLifecycleStatus,
  EventSourceType,
  EventType,
  FeaturedProject,
  Hackathon,
  Interest,
  JoinRequest,
  Membership,
  Message,
  Participation,
  ParticipationIntent,
  Profile,
  RequestDirection,
  RequestStatus,
  ReviewQueueStatus,
  SourceUrlVerificationStatus,
  Team,
  User,
} from '../types/domain.ts';

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const DEFAULT_PRIVACY: User['privacyPreferences'] = {
  profileVisible: true,
  githubConsent: false,
  aiEnrichmentConsent: false,
  academyAnnouncementsOptIn: false,
  academyTimetableOptIn: false,
};

export function mapDbUserToDomain(row: typeof schema.users.$inferSelect): User {
  return {
    uid: row.uid,
    displayName: row.displayName,
    campus: (row.campus as CampusType) || 'RR Campus',
    program: row.program ?? 'B.Tech CSE',
    graduationYear: row.graduationYear ?? 2027,
    verificationStatus:
      (row.verificationStatus as User['verificationStatus']) ||
      'verified_pesu_oidc',
    pesuOidcSub: row.pesuOidcSub,
    isAdmin: row.isAdmin,
    personaLabel: `${row.campus} · ${row.program ?? 'PES Student'}`,
    createdAt: row.createdAt.toISOString(),
    accountStatus: 'active',
    privacyPreferences: {
      ...DEFAULT_PRIVACY,
      ...safeJsonParse<Partial<User['privacyPreferences']>>(
        row.privacyPreferencesJson,
        {}
      ),
    },
  };
}

export function mapDbProfileToDomain(
  row: typeof schema.profiles.$inferSelect
): Profile {
  const skillTags = safeJsonParse<string[]>(row.skillTagsJson, []);
  const interestTags = safeJsonParse<string[]>(row.interestTagsJson, []);
  const projectDomains = safeJsonParse<string[]>(row.projectDomainsJson, []);
  return {
    uid: row.uid,
    headline: row.headline,
    about: row.about,
    skillTags,
    interestTags,
    // "What I like building". Older rows predate the dedicated column, so the
    // interest tags are used as the initial value instead of an empty list.
    projectDomains: projectDomains.length > 0 ? projectDomains : interestTags,
    topicsToExplore: safeJsonParse<string[]>(row.topicsToExploreJson, []),
    preferredRoles: safeJsonParse<string[]>(row.preferredRolesJson, []),
    rolesWantToLearn: safeJsonParse<string[]>(row.rolesWantToLearnJson, []),
    workingStyleTags: safeJsonParse<string[]>(row.workingStyleTagsJson, []),
    hackathonGoals: safeJsonParse<string[]>(row.hackathonGoalsJson, []),
    icebreakerPrompt: row.icebreakerPrompt ?? undefined,
    portfolioLinks: safeJsonParse<{ label: string; url: string }[]>(
      row.portfolioLinksJson,
      []
    ),
    featuredProjects: safeJsonParse<FeaturedProject[]>(
      row.featuredProjectsJson,
      []
    ),
    githubUsername: row.githubUsername ?? undefined,
    isFirstTimeHacker: row.isFirstTimeHacker,
    visibility:
      row.visibility === 'hidden' ? 'hidden' : 'public_verified_students',
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapDbHackathonToDomain(
  row: typeof schema.hackathons.$inferSelect
): Hackathon {
  return {
    id: row.slug,
    name: row.name,
    organizer: row.organizer,
    description: row.description,
    eventType: (row.eventType as EventType) || 'hackathon',
    matchable: row.matchable,
    themes: safeJsonParse<string[]>(row.themesJson, []),
    venue: {
      name: row.venueName ?? null,
      campus: (row.campus as CampusType | null) ?? null,
    },
    format:
      (row.format as 'onsite' | 'online' | 'hybrid' | 'unknown') || 'unknown',
    startAt: row.startAt ?? null,
    datePrecision: row.startAt
      ? row.startAt.includes('T')
        ? 'exact_instant'
        : 'date_only'
      : 'unknown',
    endAt: row.endAt ?? null,
    timezone: 'Asia/Kolkata',
    registrationDeadline: row.registrationDeadline ?? null,
    originalSubmissionUrl: row.originalSubmissionUrl ?? null,
    verifiedCanonicalUrl: row.verifiedCanonicalUrl ?? null,
    registrationUrl: row.registrationUrl ?? null,
    sourceUrlStatus:
      (row.sourceUrlStatus as SourceUrlVerificationStatus) || 'unverified',
    minTeamSize: row.minTeamSize ?? null,
    maxTeamSize: row.maxTeamSize ?? null,
    eligibilityNotes: row.eligibilityNotes ?? null,
    sourceIds: [row.slug],
    fieldProvenance: safeJsonParse(row.fieldProvenanceJson, {}),
    suggestedByCount: 1,
    classification: {
      category: (row.eventType as EventType) || 'hackathon',
      ruleGatePassed: row.ruleGatePassed,
      mlConfidenceScore: row.ruleGatePassed ? 1 : 0,
      reason: row.classificationReason || 'Verified event entry.',
    },
    lastVerifiedAt: row.createdAt.toISOString(),
    verificationStatus:
      row.verificationStatus === 'unconfirmed_constraints'
        ? 'unconfirmed_constraints'
        : 'verified',
    status: (row.status as EventLifecycleStatus) || 'published',
    createdBy: row.createdByUid,
  };
}

export function mapDbCandidateToDomain(
  row: typeof schema.eventCandidates.$inferSelect
): EventCandidate {
  return {
    id: row.candidateUid,
    source: (row.source as EventSourceType) || 'submitted_public_url',
    sourceUrl: row.sourceUrl ?? undefined,
    originalSubmissionUrl: row.originalSubmissionUrl ?? null,
    verifiedCanonicalUrl: row.verifiedCanonicalUrl ?? null,
    sourceUrlStatus:
      (row.sourceUrlStatus as SourceUrlVerificationStatus) || 'unverified',
    uploadedAttachment: safeJsonParse(row.uploadedAttachmentJson, undefined),
    submittedByUid: row.submittedByUid ?? undefined,
    externalFingerprint: row.externalFingerprint,
    duplicateOfHackathonId: row.duplicateOfHackathonSlug ?? undefined,
    updatesExistingHackathonId: row.updatesExistingHackathonSlug ?? undefined,
    title: row.title,
    organizer: row.organizer,
    eventType: (row.eventType as EventType) || 'unknown',
    matchable: row.matchable,
    themes: safeJsonParse<string[]>(row.themesJson, []),
    description: row.description,
    startAt: row.startAt ?? null,
    endAt: row.endAt ?? null,
    registrationDeadline: row.registrationDeadline ?? null,
    timezone: 'Asia/Kolkata',
    venue: {
      campus: (row.campus as CampusType | null) ?? null,
      name: row.venueName ?? null,
    },
    format:
      (row.format as 'onsite' | 'online' | 'hybrid' | 'unknown') || 'unknown',
    teamSize: {
      min: row.minTeamSize ?? null,
      max: row.maxTeamSize ?? null,
    },
    registrationUrl: row.registrationUrl ?? null,
    eligibilityNotes: row.eligibilityNotes ?? null,
    fieldEvidence: safeJsonParse(row.fieldEvidenceJson, {}),
    classification: {
      ruleGatePassed: row.ruleGatePassed,
      mlScore: row.ruleGatePassed ? 1 : 0,
      reason: row.classificationReason,
    },
    reviewStatus: (row.reviewStatus as ReviewQueueStatus) || 'needs_confirmation',
    warnings: safeJsonParse<string[]>(row.warningsJson, []),
    lastSeenAt: row.createdAt.toISOString(),
  };
}

export function isPesuSrnOrPrn(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  const s = val.trim().toUpperCase();
  if (!s) return false;
  if (/^PES[12]?(UG|PG)?[0-9]{2}[A-Z]{2}[0-9]{3,5}$/i.test(s)) return true;
  if (/^PES[0-9]{8,12}$/i.test(s)) return true;
  if (/^PES[0-9A-Z_-]{8,16}$/i.test(s) && /\d{3,}/.test(s)) return true;
  return false;
}

export async function upsertUserAndProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  campus?: CampusType;
  program?: string;
  graduationYear?: number;
  pesuOidcSub?: string;
  pesPrnOrSrn?: string;
  verified?: boolean;
  verificationStatus?: User['verificationStatus'];
  isAdmin?: boolean;
}): Promise<{ user: User; profile: Profile }> {
  try {
    const now = new Date();
    const resolvedSub =
      params.pesuOidcSub ?? params.pesPrnOrSrn ?? 'UNVERIFIED';

    // Check if user already exists to preserve custom chosen display name across logins
    const existingUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.uid, params.uid));
    const existingUser = existingUsers[0];

    let targetDisplayName = params.displayName;
    if (existingUser) {
      const currentName = existingUser.displayName?.trim();
      const isParamSrn = isPesuSrnOrPrn(params.displayName);
      const isParamPlaceholder =
        !params.displayName || params.displayName === 'PES Student' || isParamSrn;
      const isCurrentValidHuman =
        Boolean(currentName && !isPesuSrnOrPrn(currentName) && currentName !== 'PES Student');

      if (isCurrentValidHuman) {
        // Preserve a student's chosen display name across future logins
        targetDisplayName = currentName;
      } else if (!isParamPlaceholder && !isParamSrn) {
        targetDisplayName = params.displayName.trim();
      } else {
        targetDisplayName = 'PES Student';
      }
    } else {
      if (!params.displayName || isPesuSrnOrPrn(params.displayName)) {
        targetDisplayName = 'PES Student';
      } else {
        targetDisplayName = params.displayName.trim();
      }
    }

    const [userRow] = await db
      .insert(schema.users)
      .values({
        uid: params.uid,
        email: params.email,
        displayName: targetDisplayName,
        campus: params.campus ?? 'RR Campus',
        program: params.program ?? 'B.Tech CSE',
        graduationYear: params.graduationYear ?? 2027,
        verificationStatus: params.verificationStatus ?? 'verified_pesu_oidc',
        pesuOidcSub: resolvedSub,
        isAdmin: Boolean(params.isAdmin),
        privacyPreferencesJson: JSON.stringify(DEFAULT_PRIVACY),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.users.uid,
        set: {
          email: params.email,
          displayName: targetDisplayName,
          pesuOidcSub: resolvedSub,
          updatedAt: now,
        },
      })
      .returning();

    const existingProfiles = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.uid, params.uid));

    let profileRow = existingProfiles[0];
    if (!profileRow) {
      const [insertedProfile] = await db
        .insert(schema.profiles)
        .values({
          uid: params.uid,
          headline: `${params.program ?? 'B.Tech'} Builder at PES University (${
            params.campus ?? 'RR Campus'
          })`,
          about: '',
          skillTagsJson: JSON.stringify([]),
          interestTagsJson: JSON.stringify(['Applied AI/ML', 'Developer Tools']),
          projectDomainsJson: JSON.stringify([
            'Applied AI/ML',
            'Developer Tools',
          ]),
          topicsToExploreJson: JSON.stringify([]),
          hackathonGoalsJson: JSON.stringify([]),
          portfolioLinksJson: JSON.stringify([]),
          preferredRolesJson: JSON.stringify(['Generalist']),
          rolesWantToLearnJson: JSON.stringify([]),
          workingStyleTagsJson: JSON.stringify(['Fast prototyping']),
          featuredProjectsJson: JSON.stringify([]),
          isFirstTimeHacker: true,
          visibility: 'public_verified_students',
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.profiles.uid,
          set: { updatedAt: now },
        })
        .returning();
      profileRow = insertedProfile;
    }

    return {
      user: mapDbUserToDomain(userRow),
      profile: mapDbProfileToDomain(profileRow),
    };
  } catch (error) {
    console.error('Database error in upsertUserAndProfile:', error);
    throw new Error('Failed to synchronize user and profile record.', {
      cause: error,
    });
  }
}

export async function getUserAndProfileByUid(
  uid: string
): Promise<{ user: User; profile: Profile } | null> {
  try {
    const userRows = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.uid, uid));
    if (userRows.length === 0) return null;

    const profileRows = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.uid, uid));

    const user = mapDbUserToDomain(userRows[0]);
    if (profileRows.length === 0) {
      return upsertUserAndProfile({
        uid: user.uid,
        email: userRows[0].email,
        displayName: user.displayName,
        campus: user.campus,
        program: user.program,
        graduationYear: user.graduationYear,
        pesuOidcSub: user.pesuOidcSub,
        verificationStatus: user.verificationStatus,
        isAdmin: user.isAdmin,
      });
    }

    return {
      user,
      profile: mapDbProfileToDomain(profileRows[0]),
    };
  } catch (error) {
    console.error('Database error in getUserAndProfileByUid:', error);
    throw new Error('Failed to load user profile.', { cause: error });
  }
}

export async function updateUserProfileAndPrivacy(params: {
  uid: string;
  displayName?: string;
  profile: Partial<Profile>;
  privacyPreferences?: Partial<User['privacyPreferences']>;
}): Promise<{ user: User; profile: Profile }> {
  try {
    const now = new Date();
    const existingRecord = await getUserAndProfileByUid(params.uid);
    const existingUser = existingRecord?.user;
    const existingP = existingRecord?.profile;

    const mergedPrivacy: User['privacyPreferences'] = {
      ...(existingUser?.privacyPreferences ?? DEFAULT_PRIVACY),
      ...(params.privacyPreferences ?? {}),
    };

    const userSetFields: Record<string, unknown> = {
      privacyPreferencesJson: JSON.stringify(mergedPrivacy),
      updatedAt: now,
    };

    if (typeof params.displayName === 'string') {
      const trimmed = params.displayName.trim();
      if (trimmed && !isPesuSrnOrPrn(trimmed)) {
        userSetFields.displayName = trimmed;
      }
    }

    const [updatedUserRow] = await db
      .update(schema.users)
      .set(userSetFields)
      .where(eq(schema.users.uid, params.uid))
      .returning();

    const p = params.profile;

    // A client may omit fields during partial profile updates. Preserve stored values.
    const existingProfileRows = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.uid, params.uid));
    const existing = existingProfileRows[0];

    const headline =
      typeof p.headline === 'string' && p.headline.trim()
        ? p.headline.trim()
        : existingP?.headline ?? 'PES University Builder';
    const about =
      typeof p.about === 'string' ? p.about : existingP?.about ?? '';
    const skillTags = Array.isArray(p.skillTags)
      ? p.skillTags
      : existingP?.skillTags ?? [];
    const interestTags = Array.isArray(p.interestTags)
      ? p.interestTags
      : existingP?.interestTags ?? ['Applied AI/ML', 'Developer Tools'];
    const preferredRoles = Array.isArray(p.preferredRoles)
      ? p.preferredRoles
      : existingP?.preferredRoles ?? ['Generalist'];
    const rolesWantToLearn = Array.isArray(p.rolesWantToLearn)
      ? p.rolesWantToLearn
      : existingP?.rolesWantToLearn ?? [];
    const workingStyleTags = Array.isArray(p.workingStyleTags)
      ? p.workingStyleTags
      : existingP?.workingStyleTags ?? ['Fast prototyping'];
    const featuredProjects = Array.isArray(p.featuredProjects)
      ? p.featuredProjects
      : existingP?.featuredProjects ?? [];
    const githubUsername =
      p.githubUsername !== undefined
        ? p.githubUsername || null
        : existing?.githubUsername ?? null;
    const icebreakerPrompt =
      p.icebreakerPrompt !== undefined
        ? p.icebreakerPrompt || null
        : existing?.icebreakerPrompt ?? null;
    const isFirstTimeHacker =
      p.isFirstTimeHacker !== undefined
        ? Boolean(p.isFirstTimeHacker)
        : Boolean(existing?.isFirstTimeHacker);
    const visibility: Profile['visibility'] =
      p.visibility === 'hidden' || p.visibility === 'public_verified_students'
        ? p.visibility
        : existingP?.visibility ?? 'public_verified_students';

    const projectDomainsJson = JSON.stringify(
      Array.isArray(p.projectDomains)
        ? p.projectDomains
        : safeJsonParse<string[]>(existing?.projectDomainsJson, interestTags)
    );
    const topicsToExploreJson = JSON.stringify(
      Array.isArray(p.topicsToExplore)
        ? p.topicsToExplore
        : safeJsonParse<string[]>(existing?.topicsToExploreJson, [])
    );
    const hackathonGoalsJson = JSON.stringify(
      Array.isArray(p.hackathonGoals)
        ? p.hackathonGoals
        : safeJsonParse<string[]>(existing?.hackathonGoalsJson, [])
    );
    const portfolioLinksJson = JSON.stringify(
      Array.isArray(p.portfolioLinks)
        ? p.portfolioLinks
        : safeJsonParse<{ label: string; url: string }[]>(
            existing?.portfolioLinksJson,
            []
          )
    );

    const [updatedProfileRow] = await db
      .insert(schema.profiles)
      .values({
        uid: params.uid,
        headline,
        about,
        skillTagsJson: JSON.stringify(skillTags),
        interestTagsJson: JSON.stringify(interestTags),
        projectDomainsJson,
        topicsToExploreJson,
        hackathonGoalsJson,
        portfolioLinksJson,
        preferredRolesJson: JSON.stringify(preferredRoles),
        rolesWantToLearnJson: JSON.stringify(rolesWantToLearn),
        workingStyleTagsJson: JSON.stringify(workingStyleTags),
        featuredProjectsJson: JSON.stringify(featuredProjects),
        githubUsername,
        icebreakerPrompt,
        isFirstTimeHacker,
        visibility,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.profiles.uid,
        set: {
          headline,
          about,
          skillTagsJson: JSON.stringify(skillTags),
          interestTagsJson: JSON.stringify(interestTags),
          projectDomainsJson,
          topicsToExploreJson,
          hackathonGoalsJson,
          portfolioLinksJson,
          preferredRolesJson: JSON.stringify(preferredRoles),
          rolesWantToLearnJson: JSON.stringify(rolesWantToLearn),
          workingStyleTagsJson: JSON.stringify(workingStyleTags),
          featuredProjectsJson: JSON.stringify(featuredProjects),
          githubUsername,
          icebreakerPrompt,
          isFirstTimeHacker,
          visibility,
          updatedAt: now,
        },
      })
      .returning();

    return {
      user: mapDbUserToDomain(updatedUserRow),
      profile: mapDbProfileToDomain(updatedProfileRow),
    };
  } catch (error) {
    console.error('Database error in updateUserProfileAndPrivacy:', error);
    throw new Error('Failed to save profile updates.', { cause: error });
  }
}

export type OAuthTransactionLifecycleStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'expired';

export interface ClaimedOAuthTransaction {
  state: string;
  stateHash: string;
  codeHash: string | null;
  initiatingSessionIdHash: string;
  codeVerifier: string;
  redirectUri: string;
  clientOrigin: string | null;
  scopes: string[];
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string | null;
  status: OAuthTransactionLifecycleStatus;
  createdAt: Date;
  expiresAt: Date;
}

export interface OAuthTransactionRecordedOutcome {
  status: OAuthTransactionLifecycleStatus;
  completedUid: string | null;
  outcomeStatus: number;
  outcomeErrorCategory: string;
  outcomeMessage: string | null;
  outcomeIdentity: Record<string, unknown> | null;
}

export async function createOAuthTransactionRecord(params: {
  state: string;
  sessionId?: string;
  initiatingSessionId?: string;
  codeVerifier: string;
  redirectUri: string;
  clientOrigin?: string | null;
  scopes: string[];
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string | null;
  expiresAt: Date;
}): Promise<void> {
  try {
    const stateHash = hashSessionToken(params.state);
    const rawSid = params.initiatingSessionId ?? params.sessionId ?? '';
    const initiatingSessionIdHash = hashSessionToken(rawSid);
    const encryptedVerifier = encryptTokenAtRest(params.codeVerifier);
    if (!encryptedVerifier) {
      throw new Error('Failed to encrypt PKCE code_verifier.');
    }

    const now = new Date();
    // Best-effort cleanup of old expired transactions (> 1 hour expired) and marking expired rows
    await db
      .delete(schema.oauthTransactions)
      .where(
        lt(schema.oauthTransactions.expiresAt, new Date(now.getTime() - 3600_000))
      )
      .catch(() => {});

    await db
      .update(schema.oauthTransactions)
      .set({ status: 'expired', consumed: true })
      .where(
        and(
          lt(schema.oauthTransactions.expiresAt, now),
          eq(schema.oauthTransactions.status, 'pending')
        )
      )
      .catch(() => {});

    await db.insert(schema.oauthTransactions).values({
      stateHash,
      codeHash: null,
      initiatingSessionIdHash,
      encryptedCodeVerifier: encryptedVerifier,
      redirectUri: params.redirectUri,
      clientOrigin: params.clientOrigin ?? null,
      scopesJson: JSON.stringify(params.scopes),
      issuer: params.issuer,
      authorizationEndpoint: params.authorizationEndpoint,
      tokenEndpoint: params.tokenEndpoint,
      userinfoEndpoint: params.userinfoEndpoint,
      status: 'pending',
      consumed: false,
      expiresAt: params.expiresAt,
    });
  } catch (error) {
    console.error('Database error in createOAuthTransactionRecord:', error);
    throw new Error('Failed to persist OAuth authorization transaction.', {
      cause: error,
    });
  }
}

export async function claimOrInspectOAuthTransactionRecord(params: {
  state: string;
  code?: string | null;
  incomingSessionId?: string | null;
  authenticatedUid?: string | null;
}): Promise<{
  status:
    | 'claimed'
    | 'processing'
    | 'completed_same_session'
    | 'failed_previously'
    | 'session_mismatch'
    | 'expired'
    | 'replayed'
    | 'invalid';
  transactionStatus: OAuthTransactionLifecycleStatus | 'not_found';
  transaction: ClaimedOAuthTransaction | null;
  outcome?: OAuthTransactionRecordedOutcome;
}> {
  const rawState = params.state?.trim() ?? '';
  if (!rawState) {
    return {
      status: 'invalid',
      transactionStatus: 'not_found',
      transaction: null,
    };
  }

  try {
    const stateHash = hashSessionToken(rawState);
    const codeHash =
      params.code && params.code.trim()
        ? hashSessionToken(params.code.trim())
        : null;
    const incomingSidHash =
      params.incomingSessionId && params.incomingSessionId.trim()
        ? hashSessionToken(params.incomingSessionId.trim())
        : null;
    const now = new Date();

    const existingRows = await db
      .select()
      .from(schema.oauthTransactions)
      .where(eq(schema.oauthTransactions.stateHash, stateHash))
      .limit(1);

    let row = existingRows[0];
    if (!row) {
      return {
        status: 'invalid',
        transactionStatus: 'not_found',
        transaction: null,
      };
    }

    // 1. Check expiration before any state transition
    if (row.expiresAt.getTime() <= now.getTime() || row.status === 'expired') {
      if (row.status !== 'expired') {
        await db
          .update(schema.oauthTransactions)
          .set({ status: 'expired', consumed: true })
          .where(eq(schema.oauthTransactions.id, row.id))
          .catch(() => {});
      }
      return {
        status: 'expired',
        transactionStatus: 'expired',
        transaction: null,
      };
    }

    // 2. Reject callbacks arriving from a different explicit browser session
    if (
      incomingSidHash &&
      row.initiatingSessionIdHash &&
      incomingSidHash !== row.initiatingSessionIdHash
    ) {
      return {
        status: 'session_mismatch',
        transactionStatus:
          (row.status as OAuthTransactionLifecycleStatus) || 'pending',
        transaction: null,
      };
    }

    // 3. If pending, atomically claim: pending -> processing
    if (row.status === 'pending' && !row.consumed) {
      const claimedRows = await db
        .update(schema.oauthTransactions)
        .set({
          status: 'processing',
          consumed: true,
          consumedAt: now,
          codeHash,
        })
        .where(
          and(
            eq(schema.oauthTransactions.stateHash, stateHash),
            eq(schema.oauthTransactions.status, 'pending'),
            eq(schema.oauthTransactions.consumed, false)
          )
        )
        .returning();

      if (claimedRows[0]) {
        const claimed = claimedRows[0];
        const decryptedVerifier = decryptTokenAtRest(
          claimed.encryptedCodeVerifier
        );
        if (!decryptedVerifier) {
          await db
            .update(schema.oauthTransactions)
            .set({
              status: 'failed',
              completedAt: now,
              outcomeStatus: 400,
              outcomeErrorCategory: 'OAUTH_STATE_INVALID',
              outcomeMessage: 'Failed to decrypt PKCE code verifier.',
            })
            .where(eq(schema.oauthTransactions.id, claimed.id))
            .catch(() => {});
          return {
            status: 'invalid',
            transactionStatus: 'failed',
            transaction: null,
          };
        }

        return {
          status: 'claimed',
          transactionStatus: 'processing',
          transaction: {
            state: rawState,
            stateHash: claimed.stateHash,
            codeHash: claimed.codeHash ?? null,
            initiatingSessionIdHash: claimed.initiatingSessionIdHash,
            codeVerifier: decryptedVerifier,
            redirectUri: claimed.redirectUri,
            clientOrigin: claimed.clientOrigin ?? null,
            scopes: safeJsonParse<string[]>(claimed.scopesJson, []),
            issuer: claimed.issuer,
            authorizationEndpoint: claimed.authorizationEndpoint,
            tokenEndpoint: claimed.tokenEndpoint,
            userinfoEndpoint: claimed.userinfoEndpoint ?? null,
            status: 'processing',
            createdAt: claimed.createdAt,
            expiresAt: claimed.expiresAt,
          },
        };
      }

      // Another concurrent request won the CAS; re-fetch current row state
      const refreshedRows = await db
        .select()
        .from(schema.oauthTransactions)
        .where(eq(schema.oauthTransactions.stateHash, stateHash))
        .limit(1);
      if (!refreshedRows[0]) {
        return {
          status: 'invalid',
          transactionStatus: 'not_found',
          transaction: null,
        };
      }
      row = refreshedRows[0];
    }

    const baseTx: ClaimedOAuthTransaction = {
      state: rawState,
      stateHash: row.stateHash,
      codeHash: row.codeHash ?? null,
      initiatingSessionIdHash: row.initiatingSessionIdHash,
      codeVerifier: '', // Never expose verifier on already-claimed rows
      redirectUri: row.redirectUri,
      clientOrigin: row.clientOrigin ?? null,
      scopes: safeJsonParse<string[]>(row.scopesJson, []),
      issuer: row.issuer,
      authorizationEndpoint: row.authorizationEndpoint,
      tokenEndpoint: row.tokenEndpoint,
      userinfoEndpoint: row.userinfoEndpoint ?? null,
      status: (row.status as OAuthTransactionLifecycleStatus) || 'processing',
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    };

    // 4. If currently processing (concurrent duplicate callback with same code)
    if (row.status === 'processing') {
      if (codeHash && row.codeHash && codeHash !== row.codeHash) {
        return {
          status: 'replayed',
          transactionStatus: 'processing',
          transaction: null,
        };
      }
      return {
        status: 'processing',
        transactionStatus: 'processing',
        transaction: baseTx,
      };
    }

    // 5. If already completed: check if duplicate callback is from the same authenticated session & same code
    if (row.status === 'completed') {
      const sameCode = !codeHash || !row.codeHash || codeHash === row.codeHash;
      const sameInitiatingSession =
        Boolean(incomingSidHash) &&
        incomingSidHash === row.initiatingSessionIdHash;
      const sameAuthenticatedUser =
        Boolean(params.authenticatedUid) &&
        Boolean(row.completedUid) &&
        params.authenticatedUid === row.completedUid;

      if (sameCode && (sameInitiatingSession || sameAuthenticatedUser)) {
        // Also confirm the session has not been revoked in oauth_sessions
        const activeSessionRows = await db
          .select()
          .from(schema.oauthSessions)
          .where(
            and(
              eq(
                schema.oauthSessions.initiatingSessionIdHash,
                row.initiatingSessionIdHash
              ),
              eq(schema.oauthSessions.revoked, false)
            )
          )
          .orderBy(desc(schema.oauthSessions.createdAt))
          .limit(1);

        const hasActiveSession =
          sameAuthenticatedUser ||
          Boolean(
            activeSessionRows[0] &&
              activeSessionRows[0].expiresAt.getTime() > now.getTime()
          );

        if (hasActiveSession) {
          return {
            status: 'completed_same_session',
            transactionStatus: 'completed',
            transaction: baseTx,
            outcome: {
              status: 'completed',
              completedUid: row.completedUid ?? null,
              outcomeStatus: row.outcomeStatus ?? 200,
              outcomeErrorCategory: row.outcomeErrorCategory ?? 'NONE',
              outcomeMessage: row.outcomeMessage ?? null,
              outcomeIdentity: safeJsonParse<Record<string, unknown> | null>(
                row.outcomeIdentityJson,
                null
              ),
            },
          };
        }
      }

      return {
        status: 'replayed',
        transactionStatus: 'completed',
        transaction: null,
      };
    }

    // 6. If previous callback failed during token exchange or consent
    if (row.status === 'failed') {
      return {
        status: 'failed_previously',
        transactionStatus: 'failed',
        transaction: baseTx,
        outcome: {
          status: 'failed',
          completedUid: null,
          outcomeStatus: row.outcomeStatus ?? 400,
          outcomeErrorCategory:
            row.outcomeErrorCategory ?? 'OAUTH_STATE_INVALID',
          outcomeMessage: row.outcomeMessage ?? null,
          outcomeIdentity: null,
        },
      };
    }

    return {
      status: 'replayed',
      transactionStatus:
        (row.status as OAuthTransactionLifecycleStatus) || 'completed',
      transaction: null,
    };
  } catch (error) {
    console.error(
      'Database error in claimOrInspectOAuthTransactionRecord:',
      error
    );
    throw new Error('Failed to validate OAuth authorization state.', {
      cause: error,
    });
  }
}

export async function completeOAuthTransactionRecord(params: {
  state: string;
  status: 'completed' | 'failed';
  completedUid?: string | null;
  outcomeStatus: number;
  outcomeErrorCategory: string;
  outcomeMessage: string;
  outcomeIdentity?: unknown;
}): Promise<void> {
  const rawState = params.state?.trim() ?? '';
  if (!rawState) return;
  try {
    const stateHash = hashSessionToken(rawState);
    await db
      .update(schema.oauthTransactions)
      .set({
        status: params.status,
        consumed: true,
        completedAt: new Date(),
        completedUid: params.completedUid ?? null,
        outcomeStatus: params.outcomeStatus,
        outcomeErrorCategory: params.outcomeErrorCategory,
        outcomeMessage: params.outcomeMessage,
        outcomeIdentityJson: params.outcomeIdentity
          ? JSON.stringify(params.outcomeIdentity)
          : null,
      })
      .where(eq(schema.oauthTransactions.stateHash, stateHash));
  } catch (error) {
    console.error('Database error in completeOAuthTransactionRecord:', error);
  }
}

export async function waitForOAuthTransactionCompletion(
  rawState: string,
  timeoutMs = 4500
): Promise<OAuthTransactionRecordedOutcome | null> {
  const trimmed = rawState?.trim() ?? '';
  if (!trimmed) return null;
  const stateHash = hashSessionToken(trimmed);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 65));
    try {
      const rows = await db
        .select()
        .from(schema.oauthTransactions)
        .where(eq(schema.oauthTransactions.stateHash, stateHash))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.status === 'completed' || row.status === 'failed') {
        return {
          status: row.status,
          completedUid: row.completedUid ?? null,
          outcomeStatus:
            row.outcomeStatus ?? (row.status === 'completed' ? 200 : 502),
          outcomeErrorCategory:
            row.outcomeErrorCategory ??
            (row.status === 'completed'
              ? 'NONE'
              : 'OAUTH_TOKEN_EXCHANGE_FAILED'),
          outcomeMessage: row.outcomeMessage ?? null,
          outcomeIdentity: safeJsonParse<Record<string, unknown> | null>(
            row.outcomeIdentityJson,
            null
          ),
        };
      }
    } catch {
      // ignore transient poll error
    }
  }
  return null;
}

export async function consumeOAuthTransactionRecord(rawState: string): Promise<{
  status: 'valid' | 'expired' | 'replayed' | 'invalid';
  transaction: {
    state: string;
    initiatingSessionIdHash: string;
    codeVerifier: string;
    redirectUri: string;
    clientOrigin: string | null;
    scopes: string[];
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    userinfoEndpoint: string | null;
    createdAt: Date;
    expiresAt: Date;
  } | null;
}> {
  const result = await claimOrInspectOAuthTransactionRecord({
    state: rawState,
  });
  if (result.status === 'claimed' && result.transaction) {
    return {
      status: 'valid',
      transaction: result.transaction,
    };
  }
  if (result.status === 'expired') {
    return { status: 'expired', transaction: null };
  }
  if (
    result.status === 'replayed' ||
    result.status === 'processing' ||
    result.status === 'completed_same_session' ||
    result.status === 'failed_previously' ||
    result.status === 'session_mismatch'
  ) {
    return { status: 'replayed', transaction: null };
  }
  return { status: 'invalid', transaction: null };
}

export async function createOAuthSessionRecord(params: {
  sessionToken: string;
  initiatingSessionId?: string | null;
  initiatingSessionIdHash?: string | null;
  uid: string;
  pesuSub: string;
  accessToken: string | null;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: Date;
}): Promise<void> {
  try {
    const tokenHash = hashSessionToken(params.sessionToken);
    const sidHash =
      params.initiatingSessionIdHash ??
      (params.initiatingSessionId
        ? hashSessionToken(params.initiatingSessionId)
        : null);
    const encryptedAccess = encryptTokenAtRest(params.accessToken);
    const encryptedRefresh = encryptTokenAtRest(params.refreshToken);

    await db.insert(schema.oauthSessions).values({
      sessionToken: tokenHash,
      initiatingSessionIdHash: sidHash,
      uid: params.uid,
      pesuSub: params.pesuSub,
      accessToken: encryptedAccess,
      refreshToken: encryptedRefresh,
      scopesJson: JSON.stringify(params.scopes),
      expiresAt: params.expiresAt,
      revoked: false,
    });
  } catch (error) {
    console.error('Database error in createOAuthSessionRecord:', error);
    throw new Error('Failed to store OAuth session.', { cause: error });
  }
}

export async function getValidOAuthSessionRecord(sessionToken: string): Promise<{
  uid: string;
  pesuSub: string;
  accessToken: string | null;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: Date;
} | null> {
  try {
    const tokenHash = hashSessionToken(sessionToken);
    const rows = await db
      .select()
      .from(schema.oauthSessions)
      .where(
        and(
          or(
            eq(schema.oauthSessions.sessionToken, tokenHash),
            eq(schema.oauthSessions.sessionToken, sessionToken)
          ),
          eq(schema.oauthSessions.revoked, false)
        )
      )
      .orderBy(desc(schema.oauthSessions.createdAt));
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      await db
        .update(schema.oauthSessions)
        .set({ revoked: true })
        .where(eq(schema.oauthSessions.id, row.id))
        .catch(() => {});
      return null;
    }
    return {
      uid: row.uid,
      pesuSub: row.pesuSub,
      accessToken: decryptTokenAtRest(row.accessToken),
      refreshToken: decryptTokenAtRest(row.refreshToken),
      scopes: safeJsonParse<string[]>(row.scopesJson, []),
      expiresAt: row.expiresAt,
    };
  } catch (error) {
    console.error('Database error in getValidOAuthSessionRecord:', error);
    throw new Error('Failed to verify OAuth session.', { cause: error });
  }
}

export async function getValidOAuthSessionByInitiatingSessionId(
  initiatingSessionId: string
): Promise<{
  uid: string;
  pesuSub: string;
  accessToken: string | null;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: Date;
} | null> {
  if (!initiatingSessionId || !initiatingSessionId.trim()) return null;
  try {
    const sidHash = hashSessionToken(initiatingSessionId);
    const rows = await db
      .select()
      .from(schema.oauthSessions)
      .where(
        and(
          eq(schema.oauthSessions.initiatingSessionIdHash, sidHash),
          eq(schema.oauthSessions.revoked, false)
        )
      )
      .orderBy(desc(schema.oauthSessions.createdAt));
    const row = rows[0];
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
      await db
        .update(schema.oauthSessions)
        .set({ revoked: true })
        .where(eq(schema.oauthSessions.id, row.id))
        .catch(() => {});
      return null;
    }
    return {
      uid: row.uid,
      pesuSub: row.pesuSub,
      accessToken: decryptTokenAtRest(row.accessToken),
      refreshToken: decryptTokenAtRest(row.refreshToken),
      scopes: safeJsonParse<string[]>(row.scopesJson, []),
      expiresAt: row.expiresAt,
    };
  } catch (error) {
    console.error(
      'Database error in getValidOAuthSessionByInitiatingSessionId:',
      error
    );
    return null;
  }
}

export async function revokeOAuthSessionRecord(
  sessionTokenOrSid: string
): Promise<void> {
  try {
    const hashVal = hashSessionToken(sessionTokenOrSid);
    await db
      .update(schema.oauthSessions)
      .set({ revoked: true })
      .where(
        or(
          eq(schema.oauthSessions.sessionToken, hashVal),
          eq(schema.oauthSessions.sessionToken, sessionTokenOrSid),
          eq(schema.oauthSessions.initiatingSessionIdHash, hashVal)
        )
      );
  } catch (error) {
    console.error('Database error in revokeOAuthSessionRecord:', error);
    throw new Error('Failed to revoke OAuth session.', { cause: error });
  }
}

export async function loadBootstrapData(viewerUid?: string | null): Promise<{
  users: User[];
  profiles: Record<string, Profile>;
  hackathons: Hackathon[];
  eventCandidates: EventCandidate[];
  participations: Participation[];
  teams: Team[];
  memberships: Membership[];
  joinRequests: JoinRequest[];
  interests: Interest[];
  conversations: Conversation[];
  messages: Message[];
}> {
  try {
    const hasViewer = Boolean(viewerUid);
    const [
      userRows,
      profileRows,
      hackathonRows,
      candidateRows,
      partRows,
      teamRows,
      memberRows,
      joinReqRows,
      swipeRows,
      convRows,
      msgRows,
    ] = await Promise.all([
      db.select().from(schema.users).orderBy(desc(schema.users.createdAt)),
      db.select().from(schema.profiles),
      db
        .select()
        .from(schema.hackathons)
        .orderBy(desc(schema.hackathons.createdAt)),
      db
        .select()
        .from(schema.eventCandidates)
        .orderBy(desc(schema.eventCandidates.createdAt)),
      db.select().from(schema.participations),
      db.select().from(schema.teams).orderBy(desc(schema.teams.createdAt)),
      db.select().from(schema.memberships),
      hasViewer
        ? db
            .select()
            .from(schema.joinRequests)
            .orderBy(desc(schema.joinRequests.createdAt))
        : Promise.resolve([]),
      hasViewer ? db.select().from(schema.swipes) : Promise.resolve([]),
      hasViewer
        ? db
            .select()
            .from(schema.conversations)
            .orderBy(desc(schema.conversations.lastMessageAt))
        : Promise.resolve([]),
      hasViewer
        ? db.select().from(schema.messages).orderBy(schema.messages.createdAt)
        : Promise.resolve([]),
    ]);

    const users = userRows.map(mapDbUserToDomain);
    const profiles: Record<string, Profile> = {};
    for (const pr of profileRows) {
      profiles[pr.uid] = mapDbProfileToDomain(pr);
    }

    const hackathons = hackathonRows.map(mapDbHackathonToDomain);
    const eventCandidates = candidateRows.map(mapDbCandidateToDomain);

    const participations: Participation[] = partRows.map((r) => ({
      id: r.participationKey,
      hackathonId: r.hackathonSlug,
      uid: r.uid,
      intent: (r.intent as ParticipationIntent) || 'looking',
      desiredRoles: safeJsonParse<string[]>(r.desiredRolesJson, []),
      skillsOffered: safeJsonParse<string[]>(r.skillsOfferedJson, []),
      availabilityWindows: safeJsonParse<string[]>(
        r.availabilityWindowsJson,
        []
      ),
      commitmentLevel: (r.commitmentLevel as CommitmentLevel) || 'standard',
      workPreferences: safeJsonParse<string[]>(r.workPreferencesJson, []),
      discoverable: r.discoverable,
      updatedAt: r.updatedAt.toISOString(),
    }));

    const teams: Team[] = teamRows.map((t) => {
      const specs = safeJsonParse<string[]>(t.customSpecializationsJson, []);
      return {
        id: t.teamSlug,
        hackathonId: t.hackathonSlug,
        leaderId: t.leaderUid,
        name: t.name,
        pitch: t.pitch,
        projectIdea: t.projectIdea ?? undefined,
        rolesNeeded: safeJsonParse<string[]>(t.rolesNeededJson, []),
        customSpecializations: specs.length > 0 ? specs : undefined,
        desiredDomains: safeJsonParse<string[]>(t.desiredDomainsJson, []),
        availabilitySummary: t.availabilitySummary,
        workStyleTags: safeJsonParse<string[]>(t.workStyleTagsJson, []),
        targetSize: t.targetSize,
        memberCount: t.memberCount,
        status: (t.status as 'open' | 'full' | 'locked') || 'open',
        visibility: 'public',
        createdAt: t.createdAt.toISOString(),
      };
    });

    const memberships: Membership[] = memberRows.map((m) => ({
      id: m.membershipKey,
      hackathonId: m.hackathonSlug,
      teamId: m.teamSlug,
      uid: m.uid,
      role: m.role,
      joinedAt: m.joinedAt.toISOString(),
      status: (m.status as 'active' | 'left') || 'active',
    }));

    const joinRequests: JoinRequest[] = joinReqRows.map((jr) => ({
      id: jr.requestUid,
      hackathonId: jr.hackathonSlug,
      teamId: jr.teamSlug,
      applicantUid: jr.applicantUid,
      initiatorUid: jr.initiatorUid,
      proposedRole: jr.proposedRole,
      message: jr.message ?? undefined,
      direction: (jr.direction as RequestDirection) || 'application',
      status: (jr.status as RequestStatus) || 'pending',
      resolutionNote: jr.resolutionNote ?? undefined,
      createdAt: jr.createdAt.toISOString(),
      resolvedAt: jr.resolvedAt ? jr.resolvedAt.toISOString() : undefined,
    }));

    const interests: Interest[] = swipeRows.map((s) => ({
      id: s.swipeKey,
      hackathonId: s.hackathonSlug,
      fromUid: s.fromUid,
      targetType: (s.targetType as 'user' | 'team') || 'user',
      targetId: s.targetId,
      decision: (s.decision as 'interested' | 'passed') || 'interested',
      createdAt: s.createdAt.toISOString(),
    }));

    const allConvs: Conversation[] = convRows.map((c) => ({
      id: c.conversationUid,
      hackathonId: c.hackathonSlug,
      type: (c.type as 'direct_match' | 'team_roster') || 'direct_match',
      title: c.title,
      participantUids: safeJsonParse<string[]>(c.participantUidsJson, []),
      teamId: c.teamSlug ?? undefined,
      createdAt: c.createdAt.toISOString(),
      lastMessageAt: c.lastMessageAt.toISOString(),
    }));

    const conversations = viewerUid
      ? allConvs.filter((c) => c.participantUids.includes(viewerUid))
      : [];
    const allowedConvIds = new Set(conversations.map((c) => c.id));

    const messages: Message[] = msgRows
      .filter((m) => allowedConvIds.has(m.conversationUid))
      .map((m) => ({
        id: m.messageUid,
        conversationId: m.conversationUid,
        senderUid: m.senderUid,
        body: m.body,
        createdAt: m.createdAt.toISOString(),
        moderationStatus: 'clean',
      }));

    return {
      users,
      profiles,
      hackathons,
      eventCandidates,
      participations,
      teams,
      memberships,
      joinRequests,
      interests,
      conversations,
      messages,
    };
  } catch (error) {
    console.error('Database error in loadBootstrapData:', error);
    throw new Error('Failed to load application data from PostgreSQL.', {
      cause: error,
    });
  }
}

export async function upsertParticipationRecord(params: {
  hackathonSlug: string;
  uid: string;
  intent: ParticipationIntent;
  desiredRoles: string[];
  skillsOffered: string[];
  availabilityWindows: string[];
  commitmentLevel: CommitmentLevel;
  workPreferences: string[];
  discoverable: boolean;
}): Promise<Participation> {
  try {
    const participationKey = `${params.hackathonSlug}_${params.uid}`;
    const now = new Date();
    const [row] = await db
      .insert(schema.participations)
      .values({
        participationKey,
        hackathonSlug: params.hackathonSlug,
        uid: params.uid,
        intent: params.intent,
        desiredRolesJson: JSON.stringify(params.desiredRoles),
        skillsOfferedJson: JSON.stringify(params.skillsOffered),
        availabilityWindowsJson: JSON.stringify(params.availabilityWindows),
        commitmentLevel: params.commitmentLevel,
        workPreferencesJson: JSON.stringify(params.workPreferences),
        discoverable: params.discoverable,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.participations.participationKey,
        set: {
          intent: params.intent,
          desiredRolesJson: JSON.stringify(params.desiredRoles),
          skillsOfferedJson: JSON.stringify(params.skillsOffered),
          availabilityWindowsJson: JSON.stringify(params.availabilityWindows),
          commitmentLevel: params.commitmentLevel,
          workPreferencesJson: JSON.stringify(params.workPreferences),
          discoverable: params.discoverable,
          updatedAt: now,
        },
      })
      .returning();

    return {
      id: row.participationKey,
      hackathonId: row.hackathonSlug,
      uid: row.uid,
      intent: (row.intent as ParticipationIntent) || 'looking',
      desiredRoles: safeJsonParse<string[]>(row.desiredRolesJson, []),
      skillsOffered: safeJsonParse<string[]>(row.skillsOfferedJson, []),
      availabilityWindows: safeJsonParse<string[]>(
        row.availabilityWindowsJson,
        []
      ),
      commitmentLevel: (row.commitmentLevel as CommitmentLevel) || 'standard',
      workPreferences: safeJsonParse<string[]>(row.workPreferencesJson, []),
      discoverable: row.discoverable,
      updatedAt: row.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error('Database error in upsertParticipationRecord:', error);
    throw new Error('Failed to save hackathon participation.', {
      cause: error,
    });
  }
}

export async function createEventCandidateRecord(
  candidate: EventCandidate
): Promise<EventCandidate> {
  try {
    // Check duplicate fingerprint against published hackathons or pending candidates
    const existingCandidates = await db
      .select()
      .from(schema.eventCandidates)
      .where(
        eq(
          schema.eventCandidates.externalFingerprint,
          candidate.externalFingerprint
        )
      );

    let duplicateSlug = candidate.duplicateOfHackathonId ?? null;
    if (!duplicateSlug && candidate.verifiedCanonicalUrl) {
      const matchingHack = await db
        .select()
        .from(schema.hackathons)
        .where(
          eq(
            schema.hackathons.verifiedCanonicalUrl,
            candidate.verifiedCanonicalUrl
          )
        );
      if (matchingHack[0]) {
        duplicateSlug = matchingHack[0].slug;
      }
    }

    const candidateUid =
      existingCandidates[0]?.candidateUid ??
      (candidate.id || `cand_${Date.now()}`);

    const [row] = await db
      .insert(schema.eventCandidates)
      .values({
        candidateUid,
        source: candidate.source,
        sourceUrl: candidate.sourceUrl ?? null,
        originalSubmissionUrl: candidate.originalSubmissionUrl ?? null,
        verifiedCanonicalUrl: candidate.verifiedCanonicalUrl ?? null,
        sourceUrlStatus: candidate.sourceUrlStatus ?? 'unverified',
        uploadedAttachmentJson: candidate.uploadedAttachment
          ? JSON.stringify(candidate.uploadedAttachment)
          : null,
        submittedByUid: candidate.submittedByUid ?? null,
        externalFingerprint: candidate.externalFingerprint,
        duplicateOfHackathonSlug: duplicateSlug,
        updatesExistingHackathonSlug:
          candidate.updatesExistingHackathonId ?? null,
        title: candidate.title,
        organizer: candidate.organizer,
        eventType: candidate.eventType,
        matchable: candidate.matchable,
        themesJson: JSON.stringify(candidate.themes ?? []),
        description: candidate.description,
        startAt: candidate.startAt ?? null,
        endAt: candidate.endAt ?? null,
        registrationDeadline: candidate.registrationDeadline ?? null,
        campus: candidate.venue?.campus ?? null,
        venueName: candidate.venue?.name ?? null,
        format: candidate.format ?? 'unknown',
        minTeamSize: candidate.teamSize?.min ?? null,
        maxTeamSize: candidate.teamSize?.max ?? null,
        registrationUrl: candidate.registrationUrl ?? null,
        eligibilityNotes: candidate.eligibilityNotes ?? null,
        fieldEvidenceJson: JSON.stringify(candidate.fieldEvidence ?? {}),
        ruleGatePassed: candidate.classification.ruleGatePassed,
        classificationReason: candidate.classification.reason,
        reviewStatus: candidate.reviewStatus ?? 'needs_confirmation',
        warningsJson: JSON.stringify(candidate.warnings ?? []),
      })
      .onConflictDoUpdate({
        target: schema.eventCandidates.candidateUid,
        set: {
          title: candidate.title,
          organizer: candidate.organizer,
          eventType: candidate.eventType,
          matchable: candidate.matchable,
          description: candidate.description,
          startAt: candidate.startAt ?? null,
          endAt: candidate.endAt ?? null,
          registrationDeadline: candidate.registrationDeadline ?? null,
          minTeamSize: candidate.teamSize?.min ?? null,
          maxTeamSize: candidate.teamSize?.max ?? null,
          reviewStatus: candidate.reviewStatus ?? 'needs_confirmation',
        },
      })
      .returning();

    return mapDbCandidateToDomain(row);
  } catch (error) {
    console.error('Database error in createEventCandidateRecord:', error);
    throw new Error('Failed to submit event candidate.', { cause: error });
  }
}

export async function approveEventCandidateRecord(params: {
  candidateUid: string;
  actorUid: string;
  overrides?: {
    minTeamSize?: number | null;
    maxTeamSize?: number | null;
    eventType?: EventType;
    matchable?: boolean;
    campus?: CampusType | null;
  };
}): Promise<{ hackathon: Hackathon; candidate: EventCandidate }> {
  try {
    const rows = await db
      .select()
      .from(schema.eventCandidates)
      .where(eq(schema.eventCandidates.candidateUid, params.candidateUid));

    const cand = rows[0];
    if (!cand) {
      throw new Error('Event candidate not found.');
    }

    // Overrides are applied per field: an omitted field keeps the candidate's
    // submitted value, while an explicit `null` is honoured (e.g. "team size
    // unknown" -> unconfirmed constraints).
    const hasOverride = (key: string) =>
      params.overrides !== undefined && key in params.overrides;

    const finalMin = hasOverride('minTeamSize')
      ? (params.overrides!.minTeamSize ?? null)
      : cand.minTeamSize;
    const finalMax = hasOverride('maxTeamSize')
      ? (params.overrides!.maxTeamSize ?? null)
      : cand.maxTeamSize;
    const finalType =
      params.overrides?.eventType ?? (cand.eventType as EventType);
    const finalMatchable = params.overrides?.matchable ?? cand.matchable;
    const finalCampus = hasOverride('campus')
      ? (params.overrides!.campus ?? null)
      : ((cand.campus as CampusType | null) ?? null);

    const slugBase = cand.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 36);
    const slug = `hack_${slugBase}_${Date.now().toString(36)}`;

    const [hackRow] = await db
      .insert(schema.hackathons)
      .values({
        slug,
        name: cand.title,
        organizer: cand.organizer,
        description: cand.description,
        eventType: finalType,
        matchable: finalMatchable,
        themesJson: cand.themesJson,
        campus: finalCampus ?? null,
        venueName: cand.venueName ?? null,
        format: cand.format,
        startAt: cand.startAt,
        endAt: cand.endAt,
        registrationDeadline: cand.registrationDeadline,
        originalSubmissionUrl: cand.originalSubmissionUrl ?? cand.sourceUrl,
        verifiedCanonicalUrl: cand.verifiedCanonicalUrl,
        registrationUrl: cand.registrationUrl,
        sourceUrlStatus: cand.sourceUrlStatus,
        minTeamSize: finalMin,
        maxTeamSize: finalMax,
        eligibilityNotes: cand.eligibilityNotes,
        fieldProvenanceJson: cand.fieldEvidenceJson,
        ruleGatePassed: cand.ruleGatePassed,
        classificationReason: cand.classificationReason,
        verificationStatus:
          finalMin !== null && finalMax !== null
            ? 'verified'
            : 'unconfirmed_constraints',
        status: 'published',
        createdByUid: params.actorUid,
      })
      .returning();

    const [updatedCand] = await db
      .update(schema.eventCandidates)
      .set({ reviewStatus: 'approved' })
      .where(eq(schema.eventCandidates.candidateUid, params.candidateUid))
      .returning();

    return {
      hackathon: mapDbHackathonToDomain(hackRow),
      candidate: mapDbCandidateToDomain(updatedCand),
    };
  } catch (error) {
    console.error('Database error in approveEventCandidateRecord:', error);
    throw new Error('Failed to approve and publish event candidate.', {
      cause: error,
    });
  }
}

export async function rejectEventCandidateRecord(
  candidateUid: string
): Promise<EventCandidate> {
  try {
    const [updatedCand] = await db
      .update(schema.eventCandidates)
      .set({ reviewStatus: 'rejected' })
      .where(eq(schema.eventCandidates.candidateUid, candidateUid))
      .returning();
    if (!updatedCand) {
      throw new Error('Event candidate not found.');
    }
    return mapDbCandidateToDomain(updatedCand);
  } catch (error) {
    console.error('Database error in rejectEventCandidateRecord:', error);
    throw new Error('Failed to reject event candidate.', { cause: error });
  }
}

export async function createPublishedHackathonDirect(params: {
  slug?: string;
  name: string;
  organizer: string;
  description: string;
  eventType: EventType;
  matchable: boolean;
  themes: string[];
  campus: CampusType | null;
  venueName: string | null;
  format: 'onsite' | 'online' | 'hybrid' | 'unknown';
  startAt: string | null;
  endAt: string | null;
  registrationDeadline: string | null;
  minTeamSize: number | null;
  maxTeamSize: number | null;
  registrationUrl: string | null;
  verifiedCanonicalUrl: string | null;
  sourceUrlStatus: SourceUrlVerificationStatus;
  createdByUid: string;
}): Promise<Hackathon> {
  try {
    const slug =
      params.slug ||
      `hack_${params.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 32)}_${Date.now().toString(36)}`;

    const [row] = await db
      .insert(schema.hackathons)
      .values({
        slug,
        name: params.name,
        organizer: params.organizer,
        description: params.description,
        eventType: params.eventType,
        matchable: params.matchable,
        themesJson: JSON.stringify(params.themes),
        campus: params.campus,
        venueName: params.venueName,
        format: params.format,
        startAt: params.startAt,
        endAt: params.endAt,
        registrationDeadline: params.registrationDeadline,
        originalSubmissionUrl: params.registrationUrl,
        verifiedCanonicalUrl: params.verifiedCanonicalUrl,
        registrationUrl: params.registrationUrl,
        sourceUrlStatus: params.sourceUrlStatus,
        minTeamSize: params.minTeamSize,
        maxTeamSize: params.maxTeamSize,
        ruleGatePassed: params.matchable,
        classificationReason: 'Published verified event.',
        verificationStatus:
          params.minTeamSize !== null && params.maxTeamSize !== null
            ? 'verified'
            : 'unconfirmed_constraints',
        status: 'published',
        createdByUid: params.createdByUid,
      })
      .onConflictDoUpdate({
        target: schema.hackathons.slug,
        set: {
          name: params.name,
          organizer: params.organizer,
          description: params.description,
          minTeamSize: params.minTeamSize,
          maxTeamSize: params.maxTeamSize,
        },
      })
      .returning();

    return mapDbHackathonToDomain(row);
  } catch (error) {
    console.error('Database error in createPublishedHackathonDirect:', error);
    throw new Error('Failed to create hackathon.', { cause: error });
  }
}

export async function createTeamWithLeaderRecord(params: {
  hackathonSlug: string;
  leaderUid: string;
  name: string;
  pitch: string;
  projectIdea?: string;
  rolesNeeded: string[];
  customSpecializations: string[];
  desiredDomains: string[];
  workStyleTags: string[];
  targetSize: number;
}): Promise<{
  team: Team;
  membership: Membership;
  conversation: Conversation;
}> {
  try {
    const membershipKey = `${params.hackathonSlug}_${params.leaderUid}`;
    const existingMember = await db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.membershipKey, membershipKey),
          eq(schema.memberships.status, 'active')
        )
      );

    if (existingMember.length > 0) {
      throw new Error(
        'ALREADY_IN_TEAM: You are already in an active team for this hackathon.'
      );
    }

    const hackRows = await db
      .select()
      .from(schema.hackathons)
      .where(eq(schema.hackathons.slug, params.hackathonSlug));
    const hack = hackRows[0];

    if (hack && !hack.matchable) {
      throw new Error('EVENT_NOT_MATCHABLE: This event is not eligible for team formation.');
    }
    if (hack?.registrationDeadline && new Date(hack.registrationDeadline).getTime() < Date.now()) {
      throw new Error('EVENT_REGISTRATION_CLOSED: Registration for this event has closed.');
    }
    if (hack?.endAt && new Date(hack.endAt).getTime() < Date.now()) {
      throw new Error('EVENT_ENDED: This event has ended.');
    }

    const clampedTargetSize =
      hack?.maxTeamSize != null
        ? Math.min(params.targetSize, hack.maxTeamSize)
        : params.targetSize;

    const teamSlug = `team_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;

    const [teamRow] = await db
      .insert(schema.teams)
      .values({
        teamSlug,
        hackathonSlug: params.hackathonSlug,
        leaderUid: params.leaderUid,
        name: params.name,
        pitch: params.pitch,
        projectIdea: params.projectIdea ?? null,
        rolesNeededJson: JSON.stringify(params.rolesNeeded),
        customSpecializationsJson: JSON.stringify(
          params.customSpecializations
        ),
        desiredDomainsJson: JSON.stringify(params.desiredDomains),
        availabilitySummary: 'Synced with team lead schedule',
        workStyleTagsJson: JSON.stringify(params.workStyleTags),
        targetSize: Math.max(2, clampedTargetSize),
        memberCount: 1,
        status: 'open',
      })
      .returning();

    const [memberRow] = await db
      .insert(schema.memberships)
      .values({
        membershipKey,
        hackathonSlug: params.hackathonSlug,
        teamSlug,
        uid: params.leaderUid,
        role: 'Team Lead',
        status: 'active',
      })
      .returning();

    const conversationUid = `conv_${teamSlug}`;
    const [convRow] = await db
      .insert(schema.conversations)
      .values({
        conversationUid,
        hackathonSlug: params.hackathonSlug,
        type: 'team_roster',
        title: `Team ${params.name} — Roster Channel`,
        participantUidsJson: JSON.stringify([params.leaderUid]),
        teamSlug,
      })
      .returning();

    return {
      team: {
        id: teamRow.teamSlug,
        hackathonId: teamRow.hackathonSlug,
        leaderId: teamRow.leaderUid,
        name: teamRow.name,
        pitch: teamRow.pitch,
        projectIdea: teamRow.projectIdea ?? undefined,
        rolesNeeded: params.rolesNeeded,
        customSpecializations:
          params.customSpecializations.length > 0
            ? params.customSpecializations
            : undefined,
        desiredDomains: params.desiredDomains,
        availabilitySummary: teamRow.availabilitySummary,
        workStyleTags: params.workStyleTags,
        targetSize: teamRow.targetSize,
        memberCount: teamRow.memberCount,
        status: 'open',
        visibility: 'public',
        createdAt: teamRow.createdAt.toISOString(),
      },
      membership: {
        id: memberRow.membershipKey,
        hackathonId: memberRow.hackathonSlug,
        teamId: memberRow.teamSlug,
        uid: memberRow.uid,
        role: memberRow.role,
        joinedAt: memberRow.joinedAt.toISOString(),
        status: 'active',
      },
      conversation: {
        id: convRow.conversationUid,
        hackathonId: convRow.hackathonSlug,
        type: 'team_roster',
        title: convRow.title,
        participantUids: [params.leaderUid],
        teamId: teamSlug,
        createdAt: convRow.createdAt.toISOString(),
        lastMessageAt: convRow.lastMessageAt.toISOString(),
      },
    };
  } catch (error) {
    console.error('Database error in createTeamWithLeaderRecord:', error);
    if (
      error instanceof Error &&
      (error.message.startsWith('ALREADY_IN_TEAM:') ||
        error.message.startsWith('EVENT_'))
    ) {
      throw error;
    }
    throw new Error('Failed to create team.', { cause: error });
  }
}

export async function recordSwipeAndProcessMatchRecord(params: {
  hackathonSlug: string;
  fromUid: string;
  targetType: 'user' | 'team';
  targetId: string;
  decision: 'interested' | 'passed';
  proposedRole?: string;
  note?: string;
}): Promise<{
  interest: Interest;
  mutualMatchConversation?: Conversation;
  joinRequest?: JoinRequest;
  initialMessage?: Message;
}> {
  try {
    if (params.decision === 'interested') {
      const hackRows = await db
        .select()
        .from(schema.hackathons)
        .where(eq(schema.hackathons.slug, params.hackathonSlug));
      const hack = hackRows[0];
      if (hack && !hack.matchable) {
        throw new Error('EVENT_NOT_MATCHABLE: This event is not eligible for teammate matching.');
      }
      if (hack?.registrationDeadline && new Date(hack.registrationDeadline).getTime() < Date.now()) {
        throw new Error('EVENT_REGISTRATION_CLOSED: Registration for this event has closed.');
      }
      if (hack?.endAt && new Date(hack.endAt).getTime() < Date.now()) {
        throw new Error('EVENT_ENDED: This event has ended.');
      }
    }

    const swipeKey = `${params.hackathonSlug}_${params.fromUid}_${params.targetType}_${params.targetId}`;
    const [swipeRow] = await db
      .insert(schema.swipes)
      .values({
        swipeKey,
        hackathonSlug: params.hackathonSlug,
        fromUid: params.fromUid,
        targetType: params.targetType,
        targetId: params.targetId,
        decision: params.decision,
        note: params.note ?? null,
      })
      .onConflictDoUpdate({
        target: schema.swipes.swipeKey,
        set: {
          decision: params.decision,
          note: params.note ?? null,
        },
      })
      .returning();

    const interest: Interest = {
      id: swipeRow.swipeKey,
      hackathonId: swipeRow.hackathonSlug,
      fromUid: swipeRow.fromUid,
      targetType: params.targetType,
      targetId: params.targetId,
      decision: params.decision,
      createdAt: swipeRow.createdAt.toISOString(),
    };

    if (params.decision === 'passed') {
      return { interest };
    }

    // Case A: Swiping right on an open Team -> create a JoinRequest application
    if (params.targetType === 'team') {
      const teamRows = await db
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.teamSlug, params.targetId));
      const team = teamRows[0];
      if (!team) {
        throw new Error('Target team not found.');
      }
      if (team.status !== 'open' || team.memberCount >= team.targetSize) {
        throw new Error('TEAM_FULL: This team has no open slots remaining.');
      }

      const requestUid = `req_${params.hackathonSlug}_${params.targetId}_${params.fromUid}`;
      const [reqRow] = await db
        .insert(schema.joinRequests)
        .values({
          requestUid,
          hackathonSlug: params.hackathonSlug,
          teamSlug: params.targetId,
          applicantUid: params.fromUid,
          initiatorUid: params.fromUid,
          proposedRole: params.proposedRole || 'Builder',
          message:
            params.note ||
            `Interested in joining ${team.name} as ${
              params.proposedRole || 'Builder'
            }.`,
          direction: 'application',
          status: 'pending',
        })
        .onConflictDoUpdate({
          target: schema.joinRequests.requestUid,
          set: {
            proposedRole: params.proposedRole || 'Builder',
            message:
              params.note ||
              `Interested in joining ${team.name} as ${
                params.proposedRole || 'Builder'
              }.`,
            status: 'pending',
          },
        })
        .returning();

      return {
        interest,
        joinRequest: {
          id: reqRow.requestUid,
          hackathonId: reqRow.hackathonSlug,
          teamId: reqRow.teamSlug,
          applicantUid: reqRow.applicantUid,
          initiatorUid: reqRow.initiatorUid,
          proposedRole: reqRow.proposedRole,
          message: reqRow.message ?? undefined,
          direction: 'application',
          status: 'pending',
          createdAt: reqRow.createdAt.toISOString(),
        },
      };
    }

    // Case B: Swiping right on a Person -> check if viewer is a team lead inviting them OR check mutual match
    const leaderTeams = await db
      .select()
      .from(schema.teams)
      .where(
        and(
          eq(schema.teams.hackathonSlug, params.hackathonSlug),
          eq(schema.teams.leaderUid, params.fromUid),
          eq(schema.teams.status, 'open')
        )
      );

    if (leaderTeams.length > 0) {
      const leadTeam = leaderTeams[0];
      const requestUid = `req_inv_${params.hackathonSlug}_${leadTeam.teamSlug}_${params.targetId}`;
      const [invRow] = await db
        .insert(schema.joinRequests)
        .values({
          requestUid,
          hackathonSlug: params.hackathonSlug,
          teamSlug: leadTeam.teamSlug,
          applicantUid: params.targetId,
          initiatorUid: params.fromUid,
          proposedRole: params.proposedRole || 'Builder',
          message:
            params.note || `Invited to join ${leadTeam.name}!`,
          direction: 'invitation',
          status: 'pending',
        })
        .onConflictDoUpdate({
          target: schema.joinRequests.requestUid,
          set: {
            status: 'pending',
            message: params.note || `Invited to join ${leadTeam.name}!`,
          },
        })
        .returning();

      // Also check if reverse interest exists so mutual peer match still works if both swiped
      const reverseKey = `${params.hackathonSlug}_${params.targetId}_user_${params.fromUid}`;
      const reverseSwipes = await db
        .select()
        .from(schema.swipes)
        .where(
          and(
            eq(schema.swipes.swipeKey, reverseKey),
            eq(schema.swipes.decision, 'interested')
          )
        );

      if (reverseSwipes.length === 0) {
        return {
          interest,
          joinRequest: {
            id: invRow.requestUid,
            hackathonId: invRow.hackathonSlug,
            teamId: invRow.teamSlug,
            applicantUid: invRow.applicantUid,
            initiatorUid: invRow.initiatorUid,
            proposedRole: invRow.proposedRole,
            message: invRow.message ?? undefined,
            direction: 'invitation',
            status: 'pending',
            createdAt: invRow.createdAt.toISOString(),
          },
        };
      }
    }

    // Check reverse user swipe for Mutual Match
    const reverseKey = `${params.hackathonSlug}_${params.targetId}_user_${params.fromUid}`;
    const reverseRows = await db
      .select()
      .from(schema.swipes)
      .where(
        and(
          eq(schema.swipes.swipeKey, reverseKey),
          eq(schema.swipes.decision, 'interested')
        )
      );

    if (reverseRows.length > 0) {
      const sortedPair = [params.fromUid, params.targetId].sort();
      const conversationUid = `conv_match_${params.hackathonSlug}_${sortedPair[0]}_${sortedPair[1]}`;

      const userRows = await db.select().from(schema.users);
      const fromUser = userRows.find((u) => u.uid === params.fromUid);
      const toUser = userRows.find((u) => u.uid === params.targetId);
      const title = `${fromUser?.displayName ?? params.fromUid} ↔ ${
        toUser?.displayName ?? params.targetId
      }`;

      const [convRow] = await db
        .insert(schema.conversations)
        .values({
          conversationUid,
          hackathonSlug: params.hackathonSlug,
          type: 'direct_match',
          title,
          participantUidsJson: JSON.stringify(sortedPair),
        })
        .onConflictDoUpdate({
          target: schema.conversations.conversationUid,
          set: { lastMessageAt: new Date() },
        })
        .returning();

      let initialMessage: Message | undefined;
      if (params.note && params.note.trim()) {
        const messageUid = `msg_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const [msgRow] = await db
          .insert(schema.messages)
          .values({
            messageUid,
            conversationUid,
            senderUid: params.fromUid,
            body: params.note.trim(),
          })
          .returning();

        initialMessage = {
          id: msgRow.messageUid,
          conversationId: msgRow.conversationUid,
          senderUid: msgRow.senderUid,
          body: msgRow.body,
          createdAt: msgRow.createdAt.toISOString(),
          moderationStatus: 'clean',
        };
      }

      return {
        interest,
        mutualMatchConversation: {
          id: convRow.conversationUid,
          hackathonId: convRow.hackathonSlug,
          type: 'direct_match',
          title: convRow.title,
          participantUids: sortedPair,
          createdAt: convRow.createdAt.toISOString(),
          lastMessageAt: convRow.lastMessageAt.toISOString(),
        },
        initialMessage,
      };
    }

    return { interest };
  } catch (error) {
    console.error('Database error in recordSwipeAndProcessMatchRecord:', error);
    if (
      error instanceof Error &&
      (error.message.startsWith('TEAM_FULL:') ||
        error.message.startsWith('EVENT_'))
    ) {
      throw error;
    }
    throw new Error('Failed to record swipe decision.', { cause: error });
  }
}

export async function resolveJoinRequestRecord(params: {
  requestUid: string;
  actorUid: string;
  decision: 'accept' | 'reject';
}): Promise<{
  updatedRequest: JoinRequest;
  updatedTeam?: Team;
  newMembership?: Membership;
  updatedConversation?: Conversation;
}> {
  try {
    // The whole resolution runs inside one transaction. The team row is locked
    // first (`FOR UPDATE`) and the request row second, which gives every
    // caller the same lock order and therefore serialises concurrent
    // accept/reject calls for the same team. The member counter, the
    // membership row and the request status can no longer disagree, and two
    // simultaneous accepts can no longer push a team past its maximum size.
    return await db.transaction(async (tx) => {
      // 1. Read the request (unlocked) to learn which team it belongs to.
      const initialReqRows = await tx
        .select()
        .from(schema.joinRequests)
        .where(eq(schema.joinRequests.requestUid, params.requestUid))
        .limit(1);
      const initialReq = initialReqRows[0];
      if (!initialReq) {
        throw new Error('NOT_FOUND: Join request not found.');
      }

      // 2. Lock the team row first (consistent lock order avoids deadlocks).
      const teamRows = await tx
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.teamSlug, initialReq.teamSlug))
        .for('update');
      const teamRow = teamRows[0];
      if (!teamRow) {
        throw new Error('NOT_FOUND: Team not found.');
      }

      // 3. Lock the request row and re-validate its current state.
      const reqRows = await tx
        .select()
        .from(schema.joinRequests)
        .where(eq(schema.joinRequests.requestUid, params.requestUid))
        .for('update');
      const reqRow = reqRows[0];
      if (!reqRow) {
        throw new Error('NOT_FOUND: Join request not found.');
      }
      if (reqRow.status !== 'pending') {
        // A request that was auto-expired (e.g. the team reached capacity) no
        // longer exists as an actionable request, so it is reported as 404.
        if (reqRow.status === 'expired') {
          throw new Error('NOT_FOUND: Join request no longer exists.');
        }
        throw new Error(
          `ALREADY_RESOLVED: Join request is already ${reqRow.status}.`
        );
      }

      // Verify actor authorization:
      // - For an 'application', the team leader must accept/reject
      // - For an 'invitation', the invited applicant (or team leader) can accept/reject
      const isAuthorized =
        (reqRow.direction === 'application' &&
          teamRow.leaderUid === params.actorUid) ||
        (reqRow.direction === 'invitation' &&
          (reqRow.applicantUid === params.actorUid ||
            teamRow.leaderUid === params.actorUid));

      if (!isAuthorized) {
        throw new Error(
          'FORBIDDEN: Only the team leader or invited student can resolve this request.'
        );
      }

      const now = new Date();
      if (params.decision === 'reject') {
        const [rejectedRow] = await tx
          .update(schema.joinRequests)
          .set({ status: 'rejected', resolvedAt: now })
          .where(eq(schema.joinRequests.requestUid, params.requestUid))
          .returning();

        return {
          updatedRequest: {
            id: rejectedRow.requestUid,
            hackathonId: rejectedRow.hackathonSlug,
            teamId: rejectedRow.teamSlug,
            applicantUid: rejectedRow.applicantUid,
            initiatorUid: rejectedRow.initiatorUid,
            proposedRole: rejectedRow.proposedRole,
            message: rejectedRow.message ?? undefined,
            direction:
              (rejectedRow.direction as RequestDirection) || 'application',
            status: 'rejected',
            createdAt: rejectedRow.createdAt.toISOString(),
            resolvedAt: now.toISOString(),
          },
        };
      }

      // Enforce max team size & single-team-per-hackathon constraint
      const hackRows = await tx
        .select()
        .from(schema.hackathons)
        .where(eq(schema.hackathons.slug, reqRow.hackathonSlug));
      const hack = hackRows[0];
      const maxCap =
        hack?.maxTeamSize != null
          ? Math.min(teamRow.targetSize, hack.maxTeamSize)
          : teamRow.targetSize;

      if (teamRow.memberCount >= maxCap || teamRow.status !== 'open') {
        // The request is marked as expired by the caller (outside this
        // transaction) so that the marking survives the rollback.
        throw new Error(
          `TEAM_FULL: Team "${teamRow.name}" has already reached maximum size (${maxCap}).`
        );
      }

      const membershipKey = `${reqRow.hackathonSlug}_${reqRow.applicantUid}`;
      const existingMember = await tx
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.membershipKey, membershipKey),
            eq(schema.memberships.status, 'active')
          )
        );

      if (existingMember.length > 0) {
        throw new Error(
          'ALREADY_IN_TEAM: Student is already an active member of a team in this hackathon.'
        );
      }

      const newCount = teamRow.memberCount + 1;
      const becomesFull = newCount >= maxCap;

      const [updatedTeamRow] = await tx
        .update(schema.teams)
        .set({
          memberCount: newCount,
          status: becomesFull ? 'full' : 'open',
        })
        .where(eq(schema.teams.teamSlug, teamRow.teamSlug))
        .returning();

      const [newMemberRow] = await tx
        .insert(schema.memberships)
        .values({
          membershipKey,
          hackathonSlug: reqRow.hackathonSlug,
          teamSlug: teamRow.teamSlug,
          uid: reqRow.applicantUid,
          role: reqRow.proposedRole,
          status: 'active',
        })
        .returning();

      const [acceptedReqRow] = await tx
        .update(schema.joinRequests)
        .set({ status: 'accepted', resolvedAt: now })
        .where(eq(schema.joinRequests.requestUid, params.requestUid))
        .returning();

      if (becomesFull) {
        await tx
          .update(schema.joinRequests)
          .set({
            status: 'expired',
            resolutionNote: 'Auto-expired because team reached maximum capacity.',
            resolvedAt: now,
          })
          .where(
            and(
              eq(schema.joinRequests.teamSlug, teamRow.teamSlug),
              eq(schema.joinRequests.status, 'pending')
            )
          );
      }

      // Add new member to team_roster conversation
      const convRows = await tx
        .select()
        .from(schema.conversations)
        .where(eq(schema.conversations.teamSlug, teamRow.teamSlug));
      let updatedConversation: Conversation | undefined;
      if (convRows[0]) {
        const currentParticipants = safeJsonParse<string[]>(
          convRows[0].participantUidsJson,
          []
        );
        const nextParticipants = Array.from(
          new Set([...currentParticipants, reqRow.applicantUid])
        );
        const [updatedConvRow] = await tx
          .update(schema.conversations)
          .set({
            participantUidsJson: JSON.stringify(nextParticipants),
            lastMessageAt: now,
          })
          .where(
            eq(schema.conversations.conversationUid, convRows[0].conversationUid)
          )
          .returning();

        updatedConversation = {
          id: updatedConvRow.conversationUid,
          hackathonId: updatedConvRow.hackathonSlug,
          type: 'team_roster',
          title: updatedConvRow.title,
          participantUids: nextParticipants,
          teamId: updatedConvRow.teamSlug ?? undefined,
          createdAt: updatedConvRow.createdAt.toISOString(),
          lastMessageAt: updatedConvRow.lastMessageAt.toISOString(),
        };
      }

      const specs = safeJsonParse<string[]>(
        updatedTeamRow.customSpecializationsJson,
        []
      );

      return {
        updatedRequest: {
          id: acceptedReqRow.requestUid,
          hackathonId: acceptedReqRow.hackathonSlug,
          teamId: acceptedReqRow.teamSlug,
          applicantUid: acceptedReqRow.applicantUid,
          initiatorUid: acceptedReqRow.initiatorUid,
          proposedRole: acceptedReqRow.proposedRole,
          message: acceptedReqRow.message ?? undefined,
          direction:
            (acceptedReqRow.direction as RequestDirection) || 'application',
          status: 'accepted',
          createdAt: acceptedReqRow.createdAt.toISOString(),
          resolvedAt: now.toISOString(),
        },
        updatedTeam: {
          id: updatedTeamRow.teamSlug,
          hackathonId: updatedTeamRow.hackathonSlug,
          leaderId: updatedTeamRow.leaderUid,
          name: updatedTeamRow.name,
          pitch: updatedTeamRow.pitch,
          projectIdea: updatedTeamRow.projectIdea ?? undefined,
          rolesNeeded: safeJsonParse<string[]>(
            updatedTeamRow.rolesNeededJson,
            []
          ),
          customSpecializations: specs.length > 0 ? specs : undefined,
          desiredDomains: safeJsonParse<string[]>(
            updatedTeamRow.desiredDomainsJson,
            []
          ),
          availabilitySummary: updatedTeamRow.availabilitySummary,
          workStyleTags: safeJsonParse<string[]>(
            updatedTeamRow.workStyleTagsJson,
            []
          ),
          targetSize: updatedTeamRow.targetSize,
          memberCount: updatedTeamRow.memberCount,
          status:
            (updatedTeamRow.status as 'open' | 'full' | 'locked') || 'open',
          visibility: 'public',
          createdAt: updatedTeamRow.createdAt.toISOString(),
        },
        newMembership: {
          id: newMemberRow.membershipKey,
          hackathonId: newMemberRow.hackathonSlug,
          teamId: newMemberRow.teamSlug,
          uid: newMemberRow.uid,
          role: newMemberRow.role,
          joinedAt: newMemberRow.joinedAt.toISOString(),
          status: 'active',
        },
        updatedConversation,
      };
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('TEAM_FULL:')
    ) {
      // The team is full: mark the pending request as expired. This runs
      // outside the rolled-back transaction so the status is persisted.
      try {
        await db
          .update(schema.joinRequests)
          .set({
            status: 'expired',
            resolutionNote: 'Team reached maximum capacity.',
            resolvedAt: new Date(),
          })
          .where(
            and(
              eq(schema.joinRequests.requestUid, params.requestUid),
              eq(schema.joinRequests.status, 'pending')
            )
          );
      } catch (updateError) {
        console.error(
          'Database error while expiring join request for a full team:',
          updateError
        );
      }
      throw error;
    }
    console.error('Database error in resolveJoinRequestRecord:', error);
    if (
      error instanceof Error &&
      /^(NOT_FOUND|ALREADY_RESOLVED|FORBIDDEN|TEAM_FULL|ALREADY_IN_TEAM):/.test(
        error.message
      )
    ) {
      throw error;
    }
    throw new Error('Failed to resolve join request.', { cause: error });
  }
}

export async function createMessageRecord(params: {
  conversationUid: string;
  senderUid: string;
  body: string;
}): Promise<Message> {
  try {
    const convRows = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.conversationUid, params.conversationUid));
    const conv = convRows[0];
    if (!conv) {
      throw new Error('NOT_FOUND: Conversation not found.');
    }

    const participants = safeJsonParse<string[]>(conv.participantUidsJson, []);
    if (!participants.includes(params.senderUid)) {
      throw new Error(
        'FORBIDDEN: You are not a participant in this conversation.'
      );
    }

    const messageUid = `msg_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const now = new Date();

    const [msgRow] = await db
      .insert(schema.messages)
      .values({
        messageUid,
        conversationUid: params.conversationUid,
        senderUid: params.senderUid,
        body: params.body.trim(),
        createdAt: now,
      })
      .returning();

    await db
      .update(schema.conversations)
      .set({ lastMessageAt: now })
      .where(eq(schema.conversations.conversationUid, params.conversationUid));

    return {
      id: msgRow.messageUid,
      conversationId: msgRow.conversationUid,
      senderUid: msgRow.senderUid,
      body: msgRow.body,
      createdAt: msgRow.createdAt.toISOString(),
      moderationStatus: 'clean',
    };
  } catch (error) {
    console.error('Database error in createMessageRecord:', error);
    if (
      error instanceof Error &&
      /^(NOT_FOUND|FORBIDDEN):/.test(error.message)
    ) {
      throw error;
    }
    throw new Error('Failed to send message.', { cause: error });
  }
}

export async function resetPassedSwipesForHackathon(params: {
  hackathonSlug: string;
  uid: string;
}): Promise<void> {
  try {
    await db
      .delete(schema.swipes)
      .where(
        and(
          eq(schema.swipes.hackathonSlug, params.hackathonSlug),
          eq(schema.swipes.fromUid, params.uid),
          eq(schema.swipes.decision, 'passed')
        )
      );
  } catch (error) {
    console.error('Database error in resetPassedSwipesForHackathon:', error);
    throw new Error('Failed to reset passed profiles.', { cause: error });
  }
}
