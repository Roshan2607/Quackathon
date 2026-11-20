import { and, desc, eq, inArray, lt, ne, or } from 'drizzle-orm';
import { db, pool } from './index.ts';
import * as schema from './schema.ts';
import {
  decryptTokenAtRest,
  encryptTokenAtRest,
  hashSessionToken,
} from '../lib/crypto.ts';
import {
  BlockRecord,
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
  ShortlistEntry,
  ShortlistPayload,
  SourceUrlVerificationStatus,
  Team,
  TeamProposal,
  TeamProposalStatus,
  TeamProposalVote,
  TeamRegistration,
  TeamRegistrationStatus,
  User,
} from '../types/domain.ts';
import {
  areEventsSameRealWorldEvent,
  classifyGroundedEvent,
  cleanHtmlToText,
  computeProposedEventDiffs,
  deduplicateHackathonCatalog,
  evaluateHackathonEligibilityAndStates,
  formatEventDateDisplayIST,
  isEligibleTeamHackathonCatalogEvent,
  validateAndTransformPaashaHackathon,
} from '../lib/eventsAndAnnouncements.ts';
import { isSyntheticTestHackathonRecord } from './testCleanup.ts';
import {
  chooseUpsertDisplayName,
  formatSafePublicDisplayName,
  isPlaceholderOrIdentifierDisplayName,
  normalizeHumanDisplayName,
} from '../lib/displayName.ts';

export async function ensureMatchingAndTeamSchema(): Promise<void> {
  // Tables team_proposals, team_proposal_votes, team_registrations, and user_blocks
  // are provisioned via Drizzle schema migrations / Cloud SQL UpdateSchema.
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const POLLUTED_NAVBAR_TAGS = new Set([
  'clubs & activities',
  'talks',
  'workshop',
  'management',
]);

function cleanStoredEventThemes(rawThemes: string[]): {
  themes: string[];
  hadNavbarPollution: boolean;
} {
  const normalized = rawThemes
    .map((t) => cleanHtmlToText(t).replace(/^#/, '').trim())
    .filter(Boolean);
  const lowerSet = new Set(normalized.map((t) => t.toLowerCase()));
  const hadNavbarPollution =
    lowerSet.has('clubs & activities') &&
    lowerSet.has('talks') &&
    lowerSet.has('workshop');

  if (!hadNavbarPollution) {
    return { themes: normalized, hadNavbarPollution: false };
  }

  const filtered = normalized.filter(
    (t) => !POLLUTED_NAVBAR_TAGS.has(t.toLowerCase())
  );
  return {
    themes: filtered.length > 0 ? filtered : ['PESU Event'],
    hadNavbarPollution: true,
  };
}

const DEFAULT_PRIVACY: User['privacyPreferences'] = {
  profileVisible: true,
  githubConsent: false,
  aiEnrichmentConsent: false,
  academyAnnouncementsOptIn: false,
  academyTimetableOptIn: false,
};

export function mapDbUserToDomain(row: typeof schema.users.$inferSelect): User {
  const safeDisplayName = formatSafePublicDisplayName(row.displayName);
  const needsDisplayNameSetup = isPlaceholderOrIdentifierDisplayName(
    row.displayName
  );
  return {
    uid: row.uid,
    displayName: safeDisplayName,
    needsDisplayNameSetup,
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
  const parsedProv = safeJsonParse<Record<string, any>>(
    row.fieldProvenanceJson,
    {}
  );
  const metaSource = parsedProv?._meta?.sourceType as EventSourceType | undefined;
  const combinedUrls = [
    row.verifiedCanonicalUrl,
    row.originalSubmissionUrl,
    row.registrationUrl,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const resolvedSourceType: EventSourceType =
    metaSource ||
    (combinedUrls.includes('events.pes.edu')
      ? 'pes_public_events'
      : 'submitted_public_url');

  const cleanName = cleanHtmlToText(row.name || '');
  const cleanOrganizer = cleanHtmlToText(row.organizer || '');
  const cleanDescription = cleanHtmlToText(row.description || '');
  const rawThemes = safeJsonParse<string[]>(row.themesJson, []);
  const { themes: cleanedThemes } = cleanStoredEventThemes(rawThemes);

  // Strip bogus QR-generator blog links, private pesuacademy.com URLs, or bare events.pes.edu canonical duplicates from registrationUrl
  let cleanRegistrationUrl = row.registrationUrl ?? null;
  if (cleanRegistrationUrl) {
    const lowerReg = cleanRegistrationUrl.toLowerCase();
    if (
      lowerReg.includes('me-qr.com/page/blog') ||
      lowerReg.includes('pesuacademy.com') ||
      (row.verifiedCanonicalUrl &&
        cleanRegistrationUrl === row.verifiedCanonicalUrl &&
        lowerReg.includes('events.pes.edu/'))
    ) {
      cleanRegistrationUrl = null;
    }
  }

  let cleanCanonicalUrl = row.verifiedCanonicalUrl ?? null;
  if (
    cleanCanonicalUrl &&
    cleanCanonicalUrl.toLowerCase().includes('pesuacademy.com')
  ) {
    cleanCanonicalUrl = null;
  }

  const states = evaluateHackathonEligibilityAndStates({
    name: cleanName,
    description: cleanDescription,
    eventType: (row.eventType as EventType) || 'hackathon',
    themes: cleanedThemes.filter((t) => t !== 'PESU Event'),
    minTeamSize: row.minTeamSize,
    maxTeamSize: row.maxTeamSize,
    startAt: row.startAt,
    endAt: row.endAt,
    registrationDeadline: row.registrationDeadline,
    registrationUrl: cleanRegistrationUrl,
    verifiedCanonicalUrl: cleanCanonicalUrl,
    originalSubmissionUrl: row.originalSubmissionUrl,
    sourceUrlStatus: row.sourceUrlStatus,
    sourceType: resolvedSourceType,
    status: row.status,
  });

  const resolvedEventType = states.eventType;
  const resolvedMatchable = states.matchable;
  const resolvedReason =
    row.classificationReason ||
    states.classificationReason ||
    'Verified event entry.';

  const allSourceUrls = Array.isArray(parsedProv?._meta?.allSourceUrls)
    ? (parsedProv._meta.allSourceUrls as string[]).filter(
        (u) => typeof u === 'string' && !u.toLowerCase().includes('pesuacademy.com')
      )
    : [];
  const sourceIds = Array.from(
    new Set(
      [
        row.slug,
        cleanCanonicalUrl,
        ...allSourceUrls,
      ].filter((v): v is string => Boolean(v && v.trim()))
    )
  );

  const hasPesEventsSource =
    row.slug.startsWith('pes_event_') ||
    resolvedSourceType === 'pes_public_events' ||
    sourceIds.some((s) => s.toLowerCase().includes('events.pes.edu'));
  const hasPaashaSource =
    row.slug.startsWith('paasha_') ||
    resolvedSourceType === 'paasha_microservice' ||
    sourceIds.some((s) => s.toLowerCase().startsWith('paasha:'));

  const sources = Array.from(
    new Set(
      [
        hasPesEventsSource ? 'events.pes.edu' : null,
        hasPaashaSource ? 'PAASHA' : null,
        cleanCanonicalUrl,
        cleanRegistrationUrl,
        ...allSourceUrls,
      ].filter((v): v is string => Boolean(v && v.trim()))
    )
  );

  return {
    id: row.slug,
    name: cleanName,
    organizer: cleanOrganizer,
    description: cleanDescription,
    shortDescription: cleanDescription.slice(0, 220),
    eventType: resolvedEventType,
    categoryLabel: states.categoryLabel,
    isHackathon: states.isHackathon,
    teamParticipationVerified: states.teamParticipationVerified,
    publicSourceVerified: states.publicSourceVerified,
    matchable: resolvedMatchable,
    findTeammatesEligible: states.findTeammatesEligible,
    themes: cleanedThemes,
    venue: {
      name: row.venueName ? cleanHtmlToText(row.venueName) : null,
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
    dateDisplay: formatEventDateDisplayIST({
      startAt: row.startAt,
      endAt: row.endAt,
    }),
    timezone: 'Asia/Kolkata',
    registrationDeadline: row.registrationDeadline ?? null,
    registrationStatus: states.registrationStatus,
    registrationStatusDetail: states.registrationStatusDetail,
    registrationStatusLabel: states.registrationStatusLabel,
    originalSubmissionUrl: row.originalSubmissionUrl ?? null,
    verifiedCanonicalUrl: cleanCanonicalUrl,
    registrationUrl: cleanRegistrationUrl,
    sourceUrlStatus:
      (row.sourceUrlStatus as SourceUrlVerificationStatus) || 'unverified',
    minTeamSize: states.minTeamSize,
    maxTeamSize: states.maxTeamSize,
    teamSize: {
      min: states.minTeamSize,
      max: states.maxTeamSize,
    },
    eligibilityNotes: row.eligibilityNotes ?? null,
    sourceType: resolvedSourceType,
    sourceIds,
    sources,
    fieldProvenance: parsedProv,
    suggestedByCount: Math.max(1, allSourceUrls.length || 1),
    classification: {
      category: resolvedEventType,
      ruleGatePassed: resolvedMatchable,
      mlConfidenceScore: resolvedMatchable ? 1 : 0,
      reason: resolvedReason,
    },
    lastVerifiedAt:
      parsedProv?._meta?.verifiedAt ?? row.createdAt.toISOString(),
    extractedAt:
      parsedProv?._meta?.extractedAt ?? row.createdAt.toISOString(),
    verificationStatus:
      states.teamParticipationVerified &&
      states.minTeamSize !== null &&
      states.maxTeamSize !== null
        ? 'verified'
        : 'unconfirmed_constraints',
    status: (row.status as EventLifecycleStatus) || 'published',
    createdBy: row.createdByUid,
  };
}

export function mapDbCandidateToDomain(
  row: typeof schema.eventCandidates.$inferSelect
): EventCandidate {
  const parsedEvidence = safeJsonParse<Record<string, any>>(
    row.fieldEvidenceJson,
    {}
  );
  const storedDiffs = Array.isArray(parsedEvidence?._proposedDiffs)
    ? parsedEvidence._proposedDiffs
    : undefined;
  const cleanEvidence: Record<string, { sourceUrl: string; excerpt: string }[]> =
    {};
  for (const [k, v] of Object.entries(parsedEvidence || {})) {
    if (k !== '_proposedDiffs' && Array.isArray(v)) {
      cleanEvidence[k] = v;
    }
  }

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
    proposedDiffs: storedDiffs,
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
    fieldEvidence: cleanEvidence,
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

export async function upsertUserAndProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  verifiedHumanName?: boolean;
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

    const existingUsers = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.uid, params.uid));
    const existingUserRow = existingUsers[0];
    const existingPrivacy = existingUserRow
      ? safeJsonParse<Partial<User['privacyPreferences']>>(
          existingUserRow.privacyPreferencesJson,
          {}
        )
      : {};

    const displayNameChoice = chooseUpsertDisplayName({
      existingDisplayName: existingUserRow?.displayName,
      existingCustomDisplayNameSet: Boolean(
        existingPrivacy.customDisplayNameSet
      ),
      incomingDisplayName: params.displayName,
      incomingVerifiedHumanName: params.verifiedHumanName,
    });
    const resolvedDisplayName = displayNameChoice.displayName;

    const [userRow] = await db
      .insert(schema.users)
      .values({
        uid: params.uid,
        email: params.email,
        displayName: resolvedDisplayName,
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
          displayName: resolvedDisplayName,
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
          headline: '',
          about: '',
          skillTagsJson: JSON.stringify([]),
          interestTagsJson: JSON.stringify([]),
          projectDomainsJson: JSON.stringify([]),
          topicsToExploreJson: JSON.stringify([]),
          hackathonGoalsJson: JSON.stringify([]),
          portfolioLinksJson: JSON.stringify([]),
          preferredRolesJson: JSON.stringify([]),
          rolesWantToLearnJson: JSON.stringify([]),
          workingStyleTagsJson: JSON.stringify([]),
          featuredProjectsJson: JSON.stringify([]),
          isFirstTimeHacker: false,
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
    const [userRows, profileRows] = await Promise.all([
      db.select().from(schema.users).where(eq(schema.users.uid, uid)),
      db.select().from(schema.profiles).where(eq(schema.profiles.uid, uid)),
    ]);
    if (userRows.length === 0) return null;

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

    const userUpdateSet: Partial<typeof schema.users.$inferInsert> = {
      privacyPreferencesJson: JSON.stringify(mergedPrivacy),
      updatedAt: now,
    };

    if (params.displayName !== undefined) {
      const normalized = normalizeHumanDisplayName(params.displayName);
      if (!normalized) {
        throw new Error(
          'VALIDATION_ERROR: Please enter a valid display name (cannot be empty, an SRN/PRN, or an email address).'
        );
      }
      mergedPrivacy.customDisplayNameSet = true;
      userUpdateSet.displayName = normalized;
      userUpdateSet.privacyPreferencesJson = JSON.stringify(mergedPrivacy);
    }

    const [updatedUserRow] = await db
      .update(schema.users)
      .set(userUpdateSet)
      .where(eq(schema.users.uid, params.uid))
      .returning();

    const p = params.profile;

    // A client may omit fields during partial profile updates. Preserve stored values without inventing defaults.
    const existingProfileRows = await db
      .select()
      .from(schema.profiles)
      .where(eq(schema.profiles.uid, params.uid));
    const existing = existingProfileRows[0];

    const headline =
      typeof p.headline === 'string'
        ? p.headline.trim()
        : existingP?.headline ?? '';
    const about =
      typeof p.about === 'string' ? p.about : existingP?.about ?? '';
    const skillTags = Array.isArray(p.skillTags)
      ? p.skillTags
      : existingP?.skillTags ?? [];
    const interestTags = Array.isArray(p.interestTags)
      ? p.interestTags
      : existingP?.interestTags ?? [];
    const preferredRoles = Array.isArray(p.preferredRoles)
      ? p.preferredRoles
      : existingP?.preferredRoles ?? [];
    const rolesWantToLearn = Array.isArray(p.rolesWantToLearn)
      ? p.rolesWantToLearn
      : existingP?.rolesWantToLearn ?? [];
    const workingStyleTags = Array.isArray(p.workingStyleTags)
      ? p.workingStyleTags
      : existingP?.workingStyleTags ?? [];
    const featuredProjects = Array.isArray(p.featuredProjects)
      ? p.featuredProjects.slice(0, 3)
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
    if (error instanceof Error && error.message.startsWith('VALIDATION_ERROR:')) {
      throw error;
    }
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
  candidateSessionIds?: string[];
  callbackCookieStatus?: 'valid' | 'missing' | 'invalid_signature';
  authenticatedUid?: string | null;
}): Promise<{
  status:
    | 'claimed'
    | 'processing'
    | 'completed_same_session'
    | 'failed_previously'
    | 'session_missing'
    | 'session_invalid'
    | 'session_mismatch'
    | 'expired'
    | 'replayed'
    | 'invalid';
  transactionStatus: OAuthTransactionLifecycleStatus | 'not_found';
  sessionBindingMatched: boolean;
  matchedSessionId: string | null;
  transactionMeta: {
    clientOrigin: string | null;
    redirectUri: string;
    initiatingSessionIdHash: string;
  } | null;
  transaction: ClaimedOAuthTransaction | null;
  outcome?: OAuthTransactionRecordedOutcome;
}> {
  const rawState = params.state?.trim() ?? '';
  if (!rawState) {
    return {
      status: 'invalid',
      transactionStatus: 'not_found',
      sessionBindingMatched: false,
      matchedSessionId: null,
      transactionMeta: null,
      transaction: null,
    };
  }

  try {
    const stateHash = hashSessionToken(rawState);
    const codeHash =
      params.code && params.code.trim()
        ? hashSessionToken(params.code.trim())
        : null;

    const candidateSids = Array.from(
      new Set(
        [
          ...(params.candidateSessionIds ?? []),
          params.incomingSessionId ?? '',
        ]
          .map((s) => s.trim())
          .filter(Boolean)
      )
    );

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
        sessionBindingMatched: false,
        matchedSessionId: null,
        transactionMeta: null,
        transaction: null,
      };
    }

    const transactionMeta = {
      clientOrigin: row.clientOrigin ?? null,
      redirectUri: row.redirectUri,
      initiatingSessionIdHash: row.initiatingSessionIdHash,
    };

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
        sessionBindingMatched: false,
        matchedSessionId: null,
        transactionMeta,
        transaction: null,
      };
    }

    // Check whether any verified session cookie sent by the browser matches the initiating session hash
    const matchedSessionId =
      candidateSids.find(
        (sid) => hashSessionToken(sid) === row.initiatingSessionIdHash
      ) ?? null;
    const sessionBindingMatched = Boolean(matchedSessionId);

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

    // 2. If already completed: check if duplicate callback is from the same authenticated session & same code
    if (row.status === 'completed') {
      const sameCode = !codeHash || !row.codeHash || codeHash === row.codeHash;
      const sameAuthenticatedUser =
        Boolean(params.authenticatedUid) &&
        Boolean(row.completedUid) &&
        params.authenticatedUid === row.completedUid;

      if (sameCode && (sessionBindingMatched || sameAuthenticatedUser)) {
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
            sessionBindingMatched: true,
            matchedSessionId,
            transactionMeta,
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
        sessionBindingMatched,
        matchedSessionId,
        transactionMeta,
        transaction: null,
      };
    }

    // 3. If previous callback failed during token exchange or consent
    if (row.status === 'failed') {
      return {
        status: 'failed_previously',
        transactionStatus: 'failed',
        sessionBindingMatched,
        matchedSessionId,
        transactionMeta,
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

    // 4. Enforce strict browser-session binding for pending/processing transactions
    if (row.initiatingSessionIdHash && !sessionBindingMatched) {
      const currentLifecycle =
        (row.status as OAuthTransactionLifecycleStatus) || 'pending';
      if (params.callbackCookieStatus === 'invalid_signature') {
        return {
          status: 'session_invalid',
          transactionStatus: currentLifecycle,
          sessionBindingMatched: false,
          matchedSessionId: null,
          transactionMeta,
          transaction: null,
        };
      }
      if (
        params.callbackCookieStatus === 'missing' ||
        candidateSids.length === 0
      ) {
        return {
          status: 'session_missing',
          transactionStatus: currentLifecycle,
          sessionBindingMatched: false,
          matchedSessionId: null,
          transactionMeta,
          transaction: null,
        };
      }
      return {
        status: 'session_mismatch',
        transactionStatus: currentLifecycle,
        sessionBindingMatched: false,
        matchedSessionId: null,
        transactionMeta,
        transaction: null,
      };
    }

    // 5. If pending, atomically claim: pending -> processing
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
            sessionBindingMatched: true,
            matchedSessionId,
            transactionMeta,
            transaction: null,
          };
        }

        return {
          status: 'claimed',
          transactionStatus: 'processing',
          sessionBindingMatched: true,
          matchedSessionId,
          transactionMeta,
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
          sessionBindingMatched: false,
          matchedSessionId: null,
          transactionMeta,
          transaction: null,
        };
      }
      row = refreshedRows[0];
    }

    // 6. If currently processing (concurrent duplicate callback with same code)
    if (row.status === 'processing') {
      if (codeHash && row.codeHash && codeHash !== row.codeHash) {
        return {
          status: 'replayed',
          transactionStatus: 'processing',
          sessionBindingMatched: true,
          matchedSessionId,
          transactionMeta,
          transaction: null,
        };
      }
      return {
        status: 'processing',
        transactionStatus: 'processing',
        sessionBindingMatched: true,
        matchedSessionId,
        transactionMeta,
        transaction: {
          ...baseTx,
          codeHash: row.codeHash ?? null,
          status: 'processing',
        },
      };
    }

    return {
      status: 'replayed',
      transactionStatus:
        (row.status as OAuthTransactionLifecycleStatus) || 'completed',
      sessionBindingMatched,
      matchedSessionId,
      transactionMeta,
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

    await db
      .insert(schema.oauthSessions)
      .values({
        sessionToken: tokenHash,
        initiatingSessionIdHash: sidHash,
        uid: params.uid,
        pesuSub: params.pesuSub,
        accessToken: encryptedAccess,
        refreshToken: encryptedRefresh,
        scopesJson: JSON.stringify(params.scopes),
        expiresAt: params.expiresAt,
        revoked: false,
      })
      .onConflictDoUpdate({
        target: schema.oauthSessions.sessionToken,
        set: {
          initiatingSessionIdHash: sidHash,
          uid: params.uid,
          pesuSub: params.pesuSub,
          accessToken: encryptedAccess,
          refreshToken: encryptedRefresh,
          scopesJson: JSON.stringify(params.scopes),
          expiresAt: params.expiresAt,
          revoked: false,
        },
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

export function assertHackathonEligibleForTeamFormation(
  hackRow: typeof schema.hackathons.$inferSelect | undefined
): void {
  if (!hackRow) return;
  const mapped = mapDbHackathonToDomain(hackRow);
  const ineligible =
    !mapped.matchable ||
    mapped.findTeammatesEligible === false ||
    mapped.registrationStatus === 'CLOSED' ||
    mapped.status === 'archived' ||
    mapped.status === 'completed' ||
    mapped.status === 'registration_closed';
  if (ineligible) {
    throw new Error(
      'INELIGIBLE_EVENT: Registration is closed or this event has already ended. New teammate matching and team creation are disabled.'
    );
  }
}

export async function loadBootstrapData(
  viewerUid?: string | null,
  options?: { scope?: 'initial' | 'full' }
): Promise<{
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
  teamProposals: TeamProposal[];
  teamRegistrations: Record<string, TeamRegistration>;
  blocks: BlockRecord[];
  scope: 'initial' | 'full';
}> {
  try {
    await ensureMatchingAndTeamSchema();
    const scope: 'initial' | 'full' =
      options?.scope === 'initial' ? 'initial' : 'full';
    const isInitialScope = scope === 'initial';

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
      proposalRows,
      voteRows,
      regRows,
      blockRows,
    ] = await Promise.all([
      db.select().from(schema.users).orderBy(desc(schema.users.createdAt)),
      db.select().from(schema.profiles),
      db
        .select()
        .from(schema.hackathons)
        .orderBy(desc(schema.hackathons.createdAt)),
      isInitialScope
        ? Promise.resolve([] as (typeof schema.eventCandidates.$inferSelect)[])
        : db
            .select()
            .from(schema.eventCandidates)
            .orderBy(desc(schema.eventCandidates.createdAt)),
      db.select().from(schema.participations),
      db.select().from(schema.teams).orderBy(desc(schema.teams.createdAt)),
      db.select().from(schema.memberships),
      isInitialScope
        ? Promise.resolve([] as (typeof schema.joinRequests.$inferSelect)[])
        : db
            .select()
            .from(schema.joinRequests)
            .orderBy(desc(schema.joinRequests.createdAt)),
      db.select().from(schema.swipes),
      isInitialScope
        ? Promise.resolve([] as (typeof schema.conversations.$inferSelect)[])
        : db
            .select()
            .from(schema.conversations)
            .orderBy(desc(schema.conversations.lastMessageAt)),
      isInitialScope
        ? Promise.resolve([] as (typeof schema.messages.$inferSelect)[])
        : db.select().from(schema.messages).orderBy(schema.messages.createdAt),
      isInitialScope
        ? Promise.resolve([] as (typeof schema.teamProposals.$inferSelect)[])
        : db
            .select()
            .from(schema.teamProposals)
            .orderBy(desc(schema.teamProposals.createdAt)),
      isInitialScope
        ? Promise.resolve(
            [] as (typeof schema.teamProposalVotes.$inferSelect)[]
          )
        : db.select().from(schema.teamProposalVotes),
      isInitialScope
        ? Promise.resolve(
            [] as (typeof schema.teamRegistrations.$inferSelect)[]
          )
        : db.select().from(schema.teamRegistrations),
      db.select().from(schema.userBlocks),
    ]);

    const allUsers = userRows.map(mapDbUserToDomain);
    const userNameByUid = new Map<string, string>();
    for (const u of allUsers) {
      userNameByUid.set(u.uid, u.displayName);
    }

    const viewerUser = viewerUid
      ? allUsers.find((u) => u.uid === viewerUid)
      : undefined;
    const isViewerAdmin = Boolean(viewerUser?.isAdmin);

    const allProfiles: Record<string, Profile> = {};
    for (const pr of profileRows) {
      allProfiles[pr.uid] = mapDbProfileToDomain(pr);
    }

    // Filter public discoverable users & profiles (always include the viewer's own profile)
    // Mask pesuOidcSub on non-viewer records so verified SRNs/PRNs never leak to other students.
    const users = allUsers
      .filter(
        (u) =>
          u.uid === viewerUid ||
          (u.accountStatus === 'active' &&
            u.privacyPreferences?.profileVisible !== false &&
            allProfiles[u.uid]?.visibility !== 'hidden')
      )
      .map((u) =>
        u.uid === viewerUid
          ? u
          : {
              ...u,
              pesuOidcSub: 'VERIFIED',
            }
      );

    const profiles: Record<string, Profile> = {};
    for (const u of users) {
      if (allProfiles[u.uid]) {
        profiles[u.uid] = allProfiles[u.uid];
      }
    }

    const allMappedHackathons = hackathonRows.map(mapDbHackathonToDomain);
    const hackathonBySlug = new Map<string, Hackathon>();
    for (const h of allMappedHackathons) {
      hackathonBySlug.set(h.id, h);
    }

    const isTestEnv =
      process.env.QUACKATHON_TEST_MODE === 'true' ||
      process.env.NODE_ENV === 'test';

    const eligibleHackathons = allMappedHackathons.filter((h) => {
      if (!isTestEnv && isSyntheticTestHackathonRecord(h)) {
        return false;
      }
      return isEligibleTeamHackathonCatalogEvent(h);
    });
    const hackathons = deduplicateHackathonCatalog(eligibleHackathons);

    // Only expose staged eventCandidates to admins or the student who submitted them
    const eventCandidates = candidateRows
      .filter(
        (c) =>
          isViewerAdmin ||
          (Boolean(viewerUid) && c.submittedByUid === viewerUid)
      )
      .map(mapDbCandidateToDomain);

    const participations: Participation[] = partRows
      .filter((r) => r.uid === viewerUid || r.discoverable !== false)
      .map((r) => ({
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

    const viewerTeamSlugs = new Set<string>();
    if (viewerUid) {
      for (const m of memberships) {
        if (m.uid === viewerUid && m.status === 'active') {
          viewerTeamSlugs.add(m.teamId);
        }
      }
      for (const t of teams) {
        if (t.leaderId === viewerUid) {
          viewerTeamSlugs.add(t.id);
        }
      }
    }

    // Scope joinRequests strictly to viewer's applications, invitations, or teams
    const joinRequests: JoinRequest[] = viewerUid
      ? joinReqRows
          .filter(
            (jr) =>
              jr.applicantUid === viewerUid ||
              jr.initiatorUid === viewerUid ||
              viewerTeamSlugs.has(jr.teamSlug)
          )
          .map((jr) => ({
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
          }))
      : [];

    // Scope swipes strictly to viewer's own swipes or incoming 'interested' swipes on the viewer/viewer's team
    const interests: Interest[] = viewerUid
      ? swipeRows
          .filter(
            (s) =>
              s.fromUid === viewerUid ||
              (s.targetType === 'user' &&
                s.targetId === viewerUid &&
                s.decision === 'interested') ||
              (s.targetType === 'team' &&
                viewerTeamSlugs.has(s.targetId) &&
                s.decision === 'interested')
          )
          .map((s) => ({
            id: s.swipeKey,
            hackathonId: s.hackathonSlug,
            fromUid: s.fromUid,
            targetType: (s.targetType as 'user' | 'team') || 'user',
            targetId: s.targetId,
            decision: (s.decision as 'interested' | 'passed') || 'interested',
            createdAt: s.createdAt.toISOString(),
          }))
      : [];

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
      ? allConvs.filter(
          (c) =>
            c.participantUids.includes(viewerUid) ||
            (c.teamId && viewerTeamSlugs.has(c.teamId))
        )
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

    // Map proposals scoped to viewer's teams or where viewer is the candidate
    const votesByProposal = new Map<string, TeamProposalVote[]>();
    for (const vr of voteRows) {
      const list = votesByProposal.get(vr.proposalUid) ?? [];
      list.push({
        id: vr.voteKey,
        proposalId: vr.proposalUid,
        teamId: vr.teamSlug,
        voterUid: vr.voterUid,
        voterName: userNameByUid.get(vr.voterUid),
        decision: (vr.decision as 'approve' | 'reject') || 'approve',
        comment: vr.comment ?? undefined,
        votedAt: vr.votedAt.toISOString(),
      });
      votesByProposal.set(vr.proposalUid, list);
    }

    const teamNameBySlug = new Map<string, string>();
    for (const t of teams) {
      teamNameBySlug.set(t.id, t.name);
    }

    const activeMembersByTeam = new Map<string, string[]>();
    for (const m of memberships) {
      if (m.status === 'active') {
        const list = activeMembersByTeam.get(m.teamId) ?? [];
        if (!list.includes(m.uid)) list.push(m.uid);
        activeMembersByTeam.set(m.teamId, list);
      }
    }

    const teamProposals: TeamProposal[] = viewerUid
      ? proposalRows
          .filter(
            (pr) =>
              pr.candidateUid === viewerUid ||
              pr.proposedByUid === viewerUid ||
              viewerTeamSlugs.has(pr.teamSlug)
          )
          .map((pr) => {
            const votes = votesByProposal.get(pr.proposalUid) ?? [];
            const requiredVoterUids = activeMembersByTeam.get(pr.teamSlug) ?? [
              pr.proposedByUid,
            ];
            const approvedCount = votes.filter(
              (v) =>
                v.decision === 'approve' &&
                requiredVoterUids.includes(v.voterUid)
            ).length;
            const candProfile = allProfiles[pr.candidateUid];
            return {
              id: pr.proposalUid,
              hackathonId: pr.hackathonSlug,
              teamId: pr.teamSlug,
              teamName: teamNameBySlug.get(pr.teamSlug),
              candidateUid: pr.candidateUid,
              candidateName: userNameByUid.get(pr.candidateUid),
              candidateHeadline: candProfile?.headline,
              candidateSkills: candProfile?.skillTags ?? [],
              proposedByUid: pr.proposedByUid,
              proposedByName: userNameByUid.get(pr.proposedByUid),
              proposedRole: pr.proposedRole,
              message: pr.message ?? undefined,
              status: (pr.status as TeamProposalStatus) || 'pending_votes',
              resolutionNote: pr.resolutionNote ?? undefined,
              votes,
              requiredVoterUids,
              approvedCount,
              requiredCount: Math.max(1, requiredVoterUids.length),
              createdAt: pr.createdAt.toISOString(),
              updatedAt: pr.updatedAt.toISOString(),
              resolvedAt: pr.resolvedAt ? pr.resolvedAt.toISOString() : undefined,
            };
          })
      : [];

    const teamRegistrations: Record<string, TeamRegistration> = {};
    const regRowByTeamSlug = new Map(regRows.map((r) => [r.teamSlug, r]));
    for (const t of teams) {
      if (viewerUid && viewerTeamSlugs.has(t.id)) {
        const hack = hackathonBySlug.get(t.hackathonId);
        const existingReg = regRowByTeamSlug.get(t.id);
        teamRegistrations[t.id] = buildTeamRegistrationDomainObject({
          team: t,
          hackathon: hack,
          regRow: existingReg,
        });
      }
    }

    const blocks: BlockRecord[] = viewerUid
      ? blockRows
          .filter(
            (b) => b.blockerUid === viewerUid || b.blockedUid === viewerUid
          )
          .map((b) => ({
            id: b.blockKey,
            blockerUid: b.blockerUid,
            blockedUid: b.blockedUid,
            createdAt: b.createdAt.toISOString(),
          }))
      : [];

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
      teamProposals,
      teamRegistrations,
      blocks,
      scope,
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
    if (params.discoverable !== false) {
      const hackRows = await db
        .select()
        .from(schema.hackathons)
        .where(eq(schema.hackathons.slug, params.hackathonSlug));
      assertHackathonEligibleForTeamFormation(hackRows[0]);
    }

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
    if (
      error instanceof Error &&
      error.message.startsWith('INELIGIBLE_EVENT:')
    ) {
      throw error;
    }
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
    // 1. Check against all existing published hackathons for cross-source duplicate or update detection
    const allPublishedRows = await db.select().from(schema.hackathons);
    let duplicateSlug = candidate.duplicateOfHackathonId ?? null;
    let updatesSlug = candidate.updatesExistingHackathonId ?? null;
    let computedDiffs = candidate.proposedDiffs ?? [];

    for (const hRow of allPublishedRows) {
      const hDomain = mapDbHackathonToDomain(hRow);
      if (
        areEventsSameRealWorldEvent(
          {
            title: hRow.name,
            description: hRow.description,
            startAt: hRow.startAt,
            endAt: hRow.endAt,
            organizer: hRow.organizer,
            verifiedCanonicalUrl: hRow.verifiedCanonicalUrl,
            originalSubmissionUrl: hRow.originalSubmissionUrl,
            registrationUrl: hRow.registrationUrl,
          },
          {
            title: candidate.title,
            description: candidate.description,
            startAt: candidate.startAt,
            endAt: candidate.endAt,
            organizer: candidate.organizer,
            verifiedCanonicalUrl: candidate.verifiedCanonicalUrl,
            originalSubmissionUrl:
              candidate.originalSubmissionUrl ?? candidate.sourceUrl,
            registrationUrl: candidate.registrationUrl,
          }
        )
      ) {
        const diffs = computeProposedEventDiffs(hDomain, {
          startAt: candidate.startAt,
          endAt: candidate.endAt,
          registrationDeadline: candidate.registrationDeadline,
          venue: candidate.venue,
          registrationUrl: candidate.registrationUrl,
          verifiedCanonicalUrl: candidate.verifiedCanonicalUrl,
          teamSize: candidate.teamSize,
          organizer: candidate.organizer,
        });

        if (diffs.length > 0 && !updatesSlug) {
          updatesSlug = hRow.slug;
          computedDiffs = diffs.map((d) => ({
            field: d.field,
            previousVerifiedValue: d.oldValue,
            newProposedValue: d.newValue,
            evidenceExcerpt: `Updated via ${candidate.source} (${candidate.verifiedCanonicalUrl ?? candidate.originalSubmissionUrl ?? candidate.sourceUrl ?? 'verified submission'})`,
          }));
        } else if (!duplicateSlug && !updatesSlug) {
          duplicateSlug = hRow.slug;
        }
        break;
      }
    }

    // 2. Check existing pending candidates across all sources so the same event from 3 sources
    //    consolidates into a single candidate entry instead of creating 3 separate cards
    const allCandidates = await db.select().from(schema.eventCandidates);
    let matchedExistingCandidate:
      | typeof schema.eventCandidates.$inferSelect
      | undefined = allCandidates.find(
      (c) => c.externalFingerprint === candidate.externalFingerprint
    );

    if (!matchedExistingCandidate) {
      matchedExistingCandidate = allCandidates.find(
        (c) =>
          (c.reviewStatus === 'new' ||
            c.reviewStatus === 'needs_confirmation') &&
          areEventsSameRealWorldEvent(
            {
              title: c.title,
              description: c.description,
              startAt: c.startAt,
              endAt: c.endAt,
              organizer: c.organizer,
              verifiedCanonicalUrl: c.verifiedCanonicalUrl,
              originalSubmissionUrl: c.originalSubmissionUrl ?? c.sourceUrl,
              registrationUrl: c.registrationUrl,
            },
            {
              title: candidate.title,
              description: candidate.description,
              startAt: candidate.startAt,
              endAt: candidate.endAt,
              organizer: candidate.organizer,
              verifiedCanonicalUrl: candidate.verifiedCanonicalUrl,
              originalSubmissionUrl:
                candidate.originalSubmissionUrl ?? candidate.sourceUrl,
              registrationUrl: candidate.registrationUrl,
            }
          )
      );
    }

    const candidateUid =
      matchedExistingCandidate?.candidateUid ??
      (candidate.id || `cand_${Date.now()}`);

    // Merge grounded fields if consolidating with an existing pending candidate
    const mergedStartAt =
      candidate.startAt ?? matchedExistingCandidate?.startAt ?? null;
    const mergedEndAt =
      candidate.endAt ?? matchedExistingCandidate?.endAt ?? null;
    const mergedDeadline =
      candidate.registrationDeadline ??
      matchedExistingCandidate?.registrationDeadline ??
      null;
    const mergedCampus =
      candidate.venue?.campus ??
      (matchedExistingCandidate?.campus as CampusType | null) ??
      null;
    const mergedVenueName =
      candidate.venue?.name ?? matchedExistingCandidate?.venueName ?? null;
    const mergedMinTeam =
      candidate.teamSize?.min ?? matchedExistingCandidate?.minTeamSize ?? null;
    const mergedMaxTeam =
      candidate.teamSize?.max ?? matchedExistingCandidate?.maxTeamSize ?? null;
    const mergedRegUrl =
      candidate.registrationUrl ??
      matchedExistingCandidate?.registrationUrl ??
      null;
    const mergedVerifiedCanonical =
      candidate.verifiedCanonicalUrl ??
      matchedExistingCandidate?.verifiedCanonicalUrl ??
      null;

    // Combine field evidence and store `_proposedDiffs` inside `fieldEvidenceJson`
    const existingEvidence = matchedExistingCandidate
      ? safeJsonParse<Record<string, any>>(
          matchedExistingCandidate.fieldEvidenceJson,
          {}
        )
      : {};
    const combinedEvidence: Record<string, any> = {
      ...existingEvidence,
      ...(candidate.fieldEvidence ?? {}),
    };
    if (computedDiffs && computedDiffs.length > 0) {
      combinedEvidence._proposedDiffs = computedDiffs;
    }

    const [row] = await db
      .insert(schema.eventCandidates)
      .values({
        candidateUid,
        source: candidate.source,
        sourceUrl:
          candidate.sourceUrl ?? matchedExistingCandidate?.sourceUrl ?? null,
        originalSubmissionUrl:
          candidate.originalSubmissionUrl ??
          matchedExistingCandidate?.originalSubmissionUrl ??
          null,
        verifiedCanonicalUrl: mergedVerifiedCanonical,
        sourceUrlStatus:
          candidate.sourceUrlStatus ??
          (matchedExistingCandidate?.sourceUrlStatus as SourceUrlVerificationStatus) ??
          'unverified',
        uploadedAttachmentJson: candidate.uploadedAttachment
          ? JSON.stringify(candidate.uploadedAttachment)
          : (matchedExistingCandidate?.uploadedAttachmentJson ?? null),
        submittedByUid:
          candidate.submittedByUid ??
          matchedExistingCandidate?.submittedByUid ??
          null,
        externalFingerprint:
          matchedExistingCandidate?.externalFingerprint ??
          candidate.externalFingerprint,
        duplicateOfHackathonSlug: duplicateSlug,
        updatesExistingHackathonSlug: updatesSlug,
        title: candidate.title || matchedExistingCandidate?.title || '',
        organizer:
          candidate.organizer || matchedExistingCandidate?.organizer || '',
        eventType: candidate.eventType,
        matchable: candidate.matchable,
        themesJson: JSON.stringify(candidate.themes ?? []),
        description:
          candidate.description || matchedExistingCandidate?.description || '',
        startAt: mergedStartAt,
        endAt: mergedEndAt,
        registrationDeadline: mergedDeadline,
        campus: mergedCampus,
        venueName: mergedVenueName,
        format:
          candidate.format && candidate.format !== 'unknown'
            ? candidate.format
            : ((matchedExistingCandidate?.format as
                | 'onsite'
                | 'online'
                | 'hybrid'
                | 'unknown') ?? 'unknown'),
        minTeamSize: mergedMinTeam,
        maxTeamSize: mergedMaxTeam,
        registrationUrl: mergedRegUrl,
        eligibilityNotes:
          candidate.eligibilityNotes ??
          matchedExistingCandidate?.eligibilityNotes ??
          null,
        fieldEvidenceJson: JSON.stringify(combinedEvidence),
        ruleGatePassed: candidate.classification.ruleGatePassed,
        classificationReason: candidate.classification.reason,
        reviewStatus: candidate.reviewStatus ?? 'needs_confirmation',
        warningsJson: JSON.stringify(candidate.warnings ?? []),
      })
      .onConflictDoUpdate({
        target: schema.eventCandidates.candidateUid,
        set: {
          title: candidate.title || matchedExistingCandidate?.title || '',
          organizer:
            candidate.organizer || matchedExistingCandidate?.organizer || '',
          eventType: candidate.eventType,
          matchable: candidate.matchable,
          description:
            candidate.description || matchedExistingCandidate?.description || '',
          startAt: mergedStartAt,
          endAt: mergedEndAt,
          registrationDeadline: mergedDeadline,
          campus: mergedCampus,
          venueName: mergedVenueName,
          minTeamSize: mergedMinTeam,
          maxTeamSize: mergedMaxTeam,
          registrationUrl: mergedRegUrl,
          verifiedCanonicalUrl: mergedVerifiedCanonical,
          duplicateOfHackathonSlug: duplicateSlug,
          updatesExistingHackathonSlug: updatesSlug,
          fieldEvidenceJson: JSON.stringify(combinedEvidence),
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

    const parsedEvidence = safeJsonParse<Record<string, any>>(
      cand.fieldEvidenceJson,
      {}
    );
    const provenanceWithMeta = {
      ...parsedEvidence,
      _meta: {
        sourceType: cand.source,
        sourceUrl:
          cand.verifiedCanonicalUrl ??
          cand.originalSubmissionUrl ??
          cand.sourceUrl ??
          'manual',
        extractedAt: cand.createdAt.toISOString(),
        verifiedBy: params.actorUid,
        verifiedAt: new Date().toISOString(),
      },
    };

    // Check if this candidate updates or duplicates an already-published hackathon
    let existingTargetSlug =
      cand.updatesExistingHackathonSlug ?? cand.duplicateOfHackathonSlug ?? null;

    if (!existingTargetSlug) {
      const allHacks = await db.select().from(schema.hackathons);
      const matchedHack = allHacks.find((h) =>
        areEventsSameRealWorldEvent(
          {
            title: h.name,
            description: h.description,
            startAt: h.startAt,
            endAt: h.endAt,
            organizer: h.organizer,
            verifiedCanonicalUrl: h.verifiedCanonicalUrl,
            originalSubmissionUrl: h.originalSubmissionUrl,
            registrationUrl: h.registrationUrl,
          },
          {
            title: cand.title,
            description: cand.description,
            startAt: cand.startAt,
            endAt: cand.endAt,
            organizer: cand.organizer,
            verifiedCanonicalUrl: cand.verifiedCanonicalUrl,
            originalSubmissionUrl: cand.originalSubmissionUrl ?? cand.sourceUrl,
            registrationUrl: cand.registrationUrl,
          }
        )
      );
      if (matchedHack) {
        existingTargetSlug = matchedHack.slug;
      }
    }

    let hackRow: typeof schema.hackathons.$inferSelect;

    if (existingTargetSlug) {
      const existingRows = await db
        .select()
        .from(schema.hackathons)
        .where(eq(schema.hackathons.slug, existingTargetSlug));
      const ex = existingRows[0];

      if (ex) {
        const exProv = safeJsonParse<Record<string, any>>(
          ex.fieldProvenanceJson,
          {}
        );
        const existingSourceUrls = Array.isArray(exProv?._meta?.allSourceUrls)
          ? (exProv._meta.allSourceUrls as string[])
          : [];
        const mergedSourceUrls = Array.from(
          new Set(
            [
              ...existingSourceUrls,
              ex.verifiedCanonicalUrl,
              cand.verifiedCanonicalUrl,
              cand.originalSubmissionUrl,
              cand.sourceUrl,
            ].filter((u): u is string => Boolean(u && u.trim()))
          )
        );
        const mergedProv = {
          ...exProv,
          ...provenanceWithMeta,
          _meta: {
            ...(exProv._meta ?? {}),
            ...provenanceWithMeta._meta,
            allSourceUrls: mergedSourceUrls,
          },
        };

        const [updatedHack] = await db
          .update(schema.hackathons)
          .set({
            name: cleanHtmlToText(cand.title || ex.name),
            organizer: cleanHtmlToText(cand.organizer || ex.organizer),
            description: cleanHtmlToText(cand.description || ex.description),
            eventType: finalType,
            matchable: finalMatchable,
            campus: finalCampus ?? ex.campus,
            venueName: cand.venueName ?? ex.venueName,
            startAt: cand.startAt ?? ex.startAt,
            endAt: cand.endAt ?? ex.endAt,
            registrationDeadline:
              cand.registrationDeadline ?? ex.registrationDeadline,
            verifiedCanonicalUrl:
              ex.verifiedCanonicalUrl ?? cand.verifiedCanonicalUrl,
            registrationUrl: cand.registrationUrl ?? ex.registrationUrl,
            minTeamSize: finalMin ?? ex.minTeamSize,
            maxTeamSize: finalMax ?? ex.maxTeamSize,
            fieldProvenanceJson: JSON.stringify(mergedProv),
            verificationStatus:
              (finalMin ?? ex.minTeamSize) !== null &&
              (finalMax ?? ex.maxTeamSize) !== null
                ? 'verified'
                : 'unconfirmed_constraints',
          })
          .where(eq(schema.hackathons.slug, ex.slug))
          .returning();
        hackRow = updatedHack;
      } else {
        existingTargetSlug = null;
      }
    }

    if (!existingTargetSlug) {
      const slugBase = cand.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 36);
      const slug = `hack_${slugBase}_${Date.now().toString(36)}`;

      const [insertedHack] = await db
        .insert(schema.hackathons)
        .values({
          slug,
          name: cleanHtmlToText(cand.title),
          organizer: cleanHtmlToText(cand.organizer),
          description: cleanHtmlToText(cand.description),
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
          fieldProvenanceJson: JSON.stringify(provenanceWithMeta),
          ruleGatePassed: cand.ruleGatePassed,
          classificationReason: cand.classificationReason,
          verificationStatus:
            finalMin !== null && finalMax !== null
              ? 'verified'
              : 'unconfirmed_constraints',
          status: finalMatchable ? 'published' : 'archived',
          createdByUid: params.actorUid,
        })
        .returning();
      hackRow = insertedHack;
    }

    const [updatedCand] = await db
      .update(schema.eventCandidates)
      .set({
        reviewStatus: 'approved',
        duplicateOfHackathonSlug: existingTargetSlug ?? hackRow!.slug,
      })
      .where(eq(schema.eventCandidates.candidateUid, params.candidateUid))
      .returning();

    return {
      hackathon: mapDbHackathonToDomain(hackRow!),
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

/**
 * Re-links any teams, memberships, participations, joinRequests, swipes, conversations,
 * teamProposals, and teamRegistrations from a duplicate `oldSlug` to the canonical `newSlug`
 * so existing teams and student state remain intact across cross-source deduplication.
 */
export async function relinkHackathonForeignKeys(
  oldSlug: string,
  newSlug: string
): Promise<void> {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return;
  try {
    await db
      .update(schema.teams)
      .set({ hackathonSlug: newSlug })
      .where(eq(schema.teams.hackathonSlug, oldSlug))
      .catch(() => {});
    await db
      .update(schema.memberships)
      .set({ hackathonSlug: newSlug })
      .where(eq(schema.memberships.hackathonSlug, oldSlug))
      .catch(() => {});
    await db
      .update(schema.participations)
      .set({ hackathonSlug: newSlug })
      .where(eq(schema.participations.hackathonSlug, oldSlug))
      .catch(() => {});
    await db
      .update(schema.joinRequests)
      .set({ hackathonSlug: newSlug })
      .where(eq(schema.joinRequests.hackathonSlug, oldSlug))
      .catch(() => {});
    await db
      .update(schema.swipes)
      .set({ hackathonSlug: newSlug })
      .where(eq(schema.swipes.hackathonSlug, oldSlug))
      .catch(() => {});
    await db
      .update(schema.conversations)
      .set({ hackathonSlug: newSlug })
      .where(eq(schema.conversations.hackathonSlug, oldSlug))
      .catch(() => {});
    await db
      .update(schema.teamProposals)
      .set({ hackathonSlug: newSlug })
      .where(eq(schema.teamProposals.hackathonSlug, oldSlug))
      .catch(() => {});
    await db
      .update(schema.teamRegistrations)
      .set({ hackathonSlug: newSlug })
      .where(eq(schema.teamRegistrations.hackathonSlug, oldSlug))
      .catch(() => {});
    await db
      .update(schema.eventCandidates)
      .set({ duplicateOfHackathonSlug: newSlug })
      .where(eq(schema.eventCandidates.duplicateOfHackathonSlug, oldSlug))
      .catch(() => {});
  } catch {
    // Non-fatal if a composite key already exists on newSlug
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
  sourceType?: EventSourceType;
  additionalSources?: string[];
  additionalProvenance?: Record<string, any>;
  extractedAt?: string;
  classificationReason?: string;
  status?: EventLifecycleStatus;
  createdByUid: string;
}): Promise<Hackathon> {
  try {
    const cleanName = cleanHtmlToText(params.name);
    const cleanOrganizer = cleanHtmlToText(params.organizer);
    const cleanDesc = cleanHtmlToText(params.description);
    const cleanVenue = params.venueName
      ? cleanHtmlToText(params.venueName)
      : null;

    let cleanRegUrl = params.registrationUrl?.trim() || null;
    if (cleanRegUrl) {
      const lowerReg = cleanRegUrl.toLowerCase();
      if (
        lowerReg.includes('me-qr.com/page/blog') ||
        lowerReg.includes('pesuacademy.com') ||
        (params.verifiedCanonicalUrl &&
          cleanRegUrl === params.verifiedCanonicalUrl &&
          lowerReg.includes('events.pes.edu/'))
      ) {
        cleanRegUrl = null;
      }
    }

    let cleanCanonUrl = params.verifiedCanonicalUrl?.trim() || null;
    if (cleanCanonUrl && cleanCanonUrl.toLowerCase().includes('pesuacademy.com')) {
      cleanCanonUrl = null;
    }

    // Find all existing rows that match either the same real-world event OR the explicit slug
    const allPublished = await db.select().from(schema.hackathons);
    const matchingRows = allPublished.filter(
      (h) =>
        (params.slug && h.slug === params.slug) ||
        areEventsSameRealWorldEvent(
          {
            title: h.name,
            description: h.description,
            startAt: h.startAt,
            endAt: h.endAt,
            organizer: h.organizer,
            verifiedCanonicalUrl: h.verifiedCanonicalUrl,
            originalSubmissionUrl: h.originalSubmissionUrl,
            registrationUrl: h.registrationUrl,
          },
          {
            title: cleanName,
            description: cleanDesc,
            startAt: params.startAt,
            endAt: params.endAt,
            organizer: cleanOrganizer,
            verifiedCanonicalUrl: cleanCanonUrl,
            originalSubmissionUrl: cleanRegUrl ?? cleanCanonUrl,
            registrationUrl: cleanRegUrl,
          }
        )
    );

    // If multiple rows match (e.g. ADCOM 2027 across 11537 and 11523, or PES Public + PAASHA),
    // prefer official events.pes.edu slugs and canonical conference/hackathon titles
    matchingRows.sort((a, b) => {
      const aCanonicalTitle = /31st international advanced computing/i.test(
        a.name
      )
        ? 1
        : 0;
      const bCanonicalTitle = /31st international advanced computing/i.test(
        b.name
      )
        ? 1
        : 0;
      if (aCanonicalTitle !== bCanonicalTitle) {
        return bCanonicalTitle - aCanonicalTitle;
      }
      const aPesOfficial = a.slug.startsWith('pes_event_') ? 1 : 0;
      const bPesOfficial = b.slug.startsWith('pes_event_') ? 1 : 0;
      if (aPesOfficial !== bPesOfficial) {
        return bPesOfficial - aPesOfficial;
      }
      return a.slug.localeCompare(b.slug);
    });

    const primaryExisting = matchingRows[0];
    const secondaryDuplicates = matchingRows.slice(1);

    const slug =
      primaryExisting?.slug ||
      params.slug ||
      `hack_${cleanName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 32)}_${Date.now().toString(36)}`;

    // Merge all official source URLs across primary, secondary duplicates, and incoming params
    const existingProv = primaryExisting
      ? safeJsonParse<Record<string, any>>(
          primaryExisting.fieldProvenanceJson,
          {}
        )
      : {};
    const prevUrls = Array.isArray(existingProv?._meta?.allSourceUrls)
      ? (existingProv._meta.allSourceUrls as string[])
      : [];

    const allSourceUrls = Array.from(
      new Set(
        [
          ...prevUrls,
          primaryExisting?.verifiedCanonicalUrl,
          ...secondaryDuplicates.map((d) => d.verifiedCanonicalUrl),
          cleanCanonUrl,
          cleanRegUrl,
          ...(params.additionalSources ?? []),
        ].filter(
          (u): u is string =>
            Boolean(u && u.trim() && !u.toLowerCase().includes('pesuacademy.com'))
        )
      )
    );

    // Choose the best title & description when consolidating multi-page or cross-source events
    const finalName =
      primaryExisting &&
      /31st international advanced computing/i.test(primaryExisting.name) &&
      !/31st international advanced computing/i.test(cleanName)
        ? cleanHtmlToText(primaryExisting.name)
        : primaryExisting &&
            primaryExisting.slug.startsWith('pes_event_') &&
            params.sourceType === 'paasha_microservice' &&
            cleanHtmlToText(primaryExisting.name).length >= 3
          ? cleanHtmlToText(primaryExisting.name)
          : cleanName;

    const finalDesc =
      primaryExisting &&
      cleanHtmlToText(primaryExisting.description).length > cleanDesc.length &&
      primaryExisting.slug !== params.slug
        ? cleanHtmlToText(primaryExisting.description)
        : cleanDesc;

    const finalCanonicalUrl =
      primaryExisting &&
      primaryExisting.verifiedCanonicalUrl?.includes('events.pes.edu')
        ? primaryExisting.verifiedCanonicalUrl
        : primaryExisting && primaryExisting.slug !== params.slug
          ? (primaryExisting.verifiedCanonicalUrl ?? cleanCanonUrl)
          : (cleanCanonUrl ?? primaryExisting?.verifiedCanonicalUrl ?? null);

    const finalRegUrl =
      cleanRegUrl ??
      (primaryExisting?.registrationUrl &&
      primaryExisting.registrationUrl !== primaryExisting.verifiedCanonicalUrl &&
      !primaryExisting.registrationUrl.toLowerCase().includes('me-qr.com/page/blog') &&
      !primaryExisting.registrationUrl.toLowerCase().includes('pesuacademy.com')
        ? primaryExisting.registrationUrl
        : null);

    // Confidence-aware field merging: prefer verified dates from events.pes.edu when merging PAASHA,
    // and fill missing fields (like minTeamSize/maxTeamSize/registrationUrl/registrationDeadline/venue)
    const isIncomingPaashaOntoPesPublic =
      params.sourceType === 'paasha_microservice' &&
      Boolean(primaryExisting?.verifiedCanonicalUrl?.includes('events.pes.edu'));

    const mergedStartAt = isIncomingPaashaOntoPesPublic
      ? (primaryExisting?.startAt ?? params.startAt ?? null)
      : (params.startAt ?? primaryExisting?.startAt ?? null);
    const mergedEndAt = isIncomingPaashaOntoPesPublic
      ? (primaryExisting?.endAt ?? params.endAt ?? mergedStartAt)
      : (params.endAt ?? primaryExisting?.endAt ?? mergedStartAt);
    const mergedDeadline =
      params.registrationDeadline ??
      primaryExisting?.registrationDeadline ??
      null;
    const mergedCampus =
      (isIncomingPaashaOntoPesPublic
        ? (primaryExisting?.campus as CampusType | null) ?? params.campus
        : params.campus ?? (primaryExisting?.campus as CampusType | null)) ??
      null;
    const mergedVenue =
      (isIncomingPaashaOntoPesPublic
        ? primaryExisting?.venueName ?? cleanVenue
        : cleanVenue ?? primaryExisting?.venueName) ?? null;

    const rawMinTeam = params.minTeamSize ?? primaryExisting?.minTeamSize ?? null;
    const rawMaxTeam = params.maxTeamSize ?? primaryExisting?.maxTeamSize ?? null;

    const states = evaluateHackathonEligibilityAndStates({
      name: finalName,
      description: finalDesc,
      eventType: params.eventType,
      themes: params.themes,
      minTeamSize: rawMinTeam,
      maxTeamSize: rawMaxTeam,
      startAt: mergedStartAt,
      endAt: mergedEndAt,
      registrationDeadline: mergedDeadline,
      registrationUrl: finalRegUrl,
      verifiedCanonicalUrl: finalCanonicalUrl,
      sourceUrlStatus: params.sourceUrlStatus,
      sourceType:
        params.sourceType ??
        (finalCanonicalUrl?.includes('events.pes.edu')
          ? 'pes_public_events'
          : 'submitted_public_url'),
    });

    // Events with unknown team eligibility must NEVER be marked matchable: true
    const resolvedMatchable =
      params.matchable !== false && states.matchable;
    const resolvedStatus: EventLifecycleStatus =
      params.status ??
      (states.isHackathon && states.publicSourceVerified
        ? 'published'
        : 'archived');

    const nowIso = new Date().toISOString();
    const provenanceObj: Record<string, any> = {
      ...existingProv,
      ...(params.additionalProvenance ?? {}),
      _meta: {
        ...(existingProv._meta ?? {}),
        sourceType:
          finalCanonicalUrl?.includes('events.pes.edu')
            ? 'pes_public_events'
            : (params.sourceType ??
              existingProv?._meta?.sourceType ??
              'submitted_public_url'),
        sourceUrl: finalCanonicalUrl ?? finalRegUrl ?? 'manual',
        allSourceUrls,
        extractedAt: params.extractedAt ?? nowIso,
        verifiedBy: params.createdByUid,
        verifiedAt: nowIso,
      },
    };

    for (const url of allSourceUrls) {
      const key = `official_source_${url.replace(/[^a-zA-Z0-9]/g, '_').slice(-32)}`;
      if (!provenanceObj[key]) {
        provenanceObj[key] = {
          sourceUrl: url,
          sourceType: url.includes('events.pes.edu')
            ? 'pes_public_events'
            : url.startsWith('paasha:')
              ? 'paasha_microservice'
              : (params.sourceType ?? 'submitted_public_url'),
          excerpt: `Verified source reference (${url})`,
          verifiedAt: nowIso,
        };
      }
    }

    const provenanceJson = JSON.stringify(provenanceObj);

    const [row] = await db
      .insert(schema.hackathons)
      .values({
        slug,
        name: finalName,
        organizer: cleanOrganizer || primaryExisting?.organizer || 'PES University',
        description: finalDesc,
        eventType: states.eventType,
        matchable: resolvedMatchable,
        themesJson: JSON.stringify(params.themes),
        campus: mergedCampus,
        venueName: mergedVenue,
        format:
          params.format !== 'unknown'
            ? params.format
            : (primaryExisting?.format as any) || 'unknown',
        startAt: mergedStartAt,
        endAt: mergedEndAt,
        registrationDeadline: mergedDeadline,
        originalSubmissionUrl: finalRegUrl ?? finalCanonicalUrl,
        verifiedCanonicalUrl: finalCanonicalUrl,
        registrationUrl: finalRegUrl,
        sourceUrlStatus: params.sourceUrlStatus,
        minTeamSize: states.minTeamSize,
        maxTeamSize: states.maxTeamSize,
        fieldProvenanceJson: provenanceJson,
        ruleGatePassed: resolvedMatchable,
        classificationReason:
          params.classificationReason ||
          states.classificationReason ||
          'Published verified event.',
        verificationStatus:
          states.teamParticipationVerified &&
          states.minTeamSize !== null &&
          states.maxTeamSize !== null
            ? 'verified'
            : 'unconfirmed_constraints',
        status: resolvedStatus,
        createdByUid: params.createdByUid,
      })
      .onConflictDoUpdate({
        target: schema.hackathons.slug,
        set: {
          name: finalName,
          organizer:
            cleanOrganizer || primaryExisting?.organizer || 'PES University',
          description: finalDesc,
          eventType: states.eventType,
          matchable: resolvedMatchable,
          themesJson: JSON.stringify(params.themes),
          campus: mergedCampus,
          venueName: mergedVenue,
          format:
            params.format !== 'unknown'
              ? params.format
              : (primaryExisting?.format as any) || 'unknown',
          startAt: mergedStartAt,
          endAt: mergedEndAt,
          registrationDeadline: mergedDeadline,
          verifiedCanonicalUrl: finalCanonicalUrl,
          registrationUrl: finalRegUrl,
          minTeamSize: states.minTeamSize,
          maxTeamSize: states.maxTeamSize,
          fieldProvenanceJson: provenanceJson,
          ruleGatePassed: resolvedMatchable,
          classificationReason:
            params.classificationReason ||
            states.classificationReason ||
            'Published verified event.',
          verificationStatus:
            states.teamParticipationVerified &&
            states.minTeamSize !== null &&
            states.maxTeamSize !== null
              ? 'verified'
              : 'unconfirmed_constraints',
          status: resolvedStatus,
        },
      })
      .returning();

    // Re-link foreign keys and archive any secondary duplicate rows in DB
    for (const dup of secondaryDuplicates) {
      if (dup.slug !== slug) {
        await relinkHackathonForeignKeys(dup.slug, slug);
        await db
          .update(schema.hackathons)
          .set({
            status: 'archived',
            matchable: false,
            classificationReason: `Consolidated duplicate into ${slug}`,
          })
          .where(eq(schema.hackathons.slug, dup.slug))
          .catch(() => {});
      }
    }

    return mapDbHackathonToDomain(row);
  } catch (error) {
    console.error('Database error in createPublishedHackathonDirect:', error);
    throw new Error('Failed to create hackathon.', { cause: error });
  }
}

export interface PaashaIngestionSummary {
  receivedCount: number;
  publishedCount: number;
  mergedWithExistingCount: number;
  heldForReviewCount: number;
  excludedNonHackathonCount: number;
  publishedIds: string[];
  heldCandidateIds: string[];
}

/**
 * Ingests validated PAASHA microservice records into Quackathon's PostgreSQL pipeline:
 * - Stages candidate records in `event_candidates` with sanitized provenance.
 * - Excludes non-hackathons (`isHackathon === false`).
 * - Holds events with missing public proof (`publicSourceVerified === false`) or unknown team
 *   participation (`teamParticipationVerified === false`) in `needs_confirmation` unless they
 *   enrich an already-published official `events.pes.edu` hackathon.
 * - Cross-source deduplicates against existing `hackathons` rows (`events.pes.edu` + PAASHA)
 *   without changing existing `hackathon.id` slugs or breaking linked teams/participations.
 */
export async function ingestPaashaHackathonsToDatabase(params: {
  items: import('../services/paashaClient').PaashaHackathonItem[];
  actorUid?: string;
}): Promise<PaashaIngestionSummary> {
  const actorUid = params.actorUid ?? 'system_paasha_sync';
  const summary: PaashaIngestionSummary = {
    receivedCount: params.items.length,
    publishedCount: 0,
    mergedWithExistingCount: 0,
    heldForReviewCount: 0,
    excludedNonHackathonCount: 0,
    publishedIds: [],
    heldCandidateIds: [],
  };

  for (const rawItem of params.items) {
    const validated = validateAndTransformPaashaHackathon(rawItem);
    const candidateUid = `cand_paasha_${validated.paashaId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}`;

    // Check if an existing published hackathon already represents this real-world event
    const existingHacks = await db.select().from(schema.hackathons);
    const matchedExisting = existingHacks.find((h) =>
      areEventsSameRealWorldEvent(
        {
          title: h.name,
          description: h.description,
          startAt: h.startAt,
          endAt: h.endAt,
          organizer: h.organizer,
          verifiedCanonicalUrl: h.verifiedCanonicalUrl,
          originalSubmissionUrl: h.originalSubmissionUrl,
          registrationUrl: h.registrationUrl,
        },
        {
          title: validated.title,
          description: validated.description,
          startAt: validated.startAt,
          endAt: validated.endAt,
          organizer: validated.organizer,
          verifiedCanonicalUrl: validated.verifiedCanonicalUrl,
          originalSubmissionUrl:
            validated.registrationUrl ?? validated.verifiedCanonicalUrl,
          registrationUrl: validated.registrationUrl,
        }
      )
    );

    const canEnrichExistingHackathon =
      Boolean(matchedExisting) &&
      validated.isHackathon &&
      matchedExisting!.status !== 'archived';

    const shouldPublishOrMerge =
      validated.shouldPublishToCatalog || canEnrichExistingHackathon;

    let linkedSlug: string | null = matchedExisting?.slug ?? null;

    if (!validated.isHackathon) {
      summary.excludedNonHackathonCount += 1;
    } else if (shouldPublishOrMerge) {
      const wasExisting = Boolean(matchedExisting);
      const cleanPaashaIdSlug = validated.paashaId
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 48);
      const defaultPaashaSlug = cleanPaashaIdSlug.startsWith('paasha_')
        ? cleanPaashaIdSlug
        : `paasha_${cleanPaashaIdSlug.slice(0, 40)}`;
      const published = await createPublishedHackathonDirect({
        slug: matchedExisting?.slug ?? defaultPaashaSlug,
        name: validated.title,
        organizer: validated.organizer,
        description: validated.description,
        eventType: validated.eventType,
        matchable: validated.matchable || Boolean(matchedExisting?.matchable),
        themes: validated.themes,
        campus: validated.campus,
        venueName: validated.venueName,
        format: validated.format,
        startAt: validated.startAt,
        endAt: validated.endAt,
        registrationDeadline: validated.registrationDeadline,
        minTeamSize: validated.minTeamSize,
        maxTeamSize: validated.maxTeamSize,
        registrationUrl: validated.registrationUrl ?? null,
        verifiedCanonicalUrl: validated.verifiedCanonicalUrl ?? null,
        sourceUrlStatus: validated.publicSourceVerified ? 'verified' : 'unverified',
        sourceType: 'paasha_microservice',
        additionalSources: validated.sources,
        additionalProvenance: validated.fieldProvenance,
        classificationReason: validated.rejectionOrHoldReason,
        createdByUid: actorUid,
      });
      linkedSlug = published.id;
      if (wasExisting) {
        summary.mergedWithExistingCount += 1;
      } else {
        summary.publishedCount += 1;
      }
      if (!summary.publishedIds.includes(published.id)) {
        summary.publishedIds.push(published.id);
      }
    } else {
      summary.heldForReviewCount += 1;
      summary.heldCandidateIds.push(candidateUid);
    }

    const candReviewStatus = !validated.isHackathon
      ? 'rejected'
      : shouldPublishOrMerge
        ? 'approved'
        : 'needs_confirmation';

    await db
      .insert(schema.eventCandidates)
      .values({
        candidateUid,
        source: 'paasha_microservice',
        sourceUrl:
          validated.verifiedCanonicalUrl ??
          validated.registrationUrl ??
          null,
        originalSubmissionUrl:
          validated.registrationUrl ??
          validated.verifiedCanonicalUrl ??
          null,
        verifiedCanonicalUrl: validated.verifiedCanonicalUrl,
        sourceUrlStatus: validated.publicSourceVerified
          ? 'verified'
          : 'unverified',
        externalFingerprint: validated.externalFingerprint,
        duplicateOfHackathonSlug: linkedSlug,
        updatesExistingHackathonSlug: matchedExisting?.slug ?? null,
        title: validated.title,
        organizer: validated.organizer,
        eventType: validated.eventType,
        matchable: validated.matchable,
        themesJson: JSON.stringify(validated.themes),
        description: validated.description,
        startAt: validated.startAt,
        endAt: validated.endAt,
        registrationDeadline: validated.registrationDeadline,
        campus: validated.campus,
        venueName: validated.venueName,
        format: validated.format,
        minTeamSize: validated.minTeamSize,
        maxTeamSize: validated.maxTeamSize,
        registrationUrl: validated.registrationUrl,
        fieldEvidenceJson: JSON.stringify({
          paasha: [
            {
              sourceUrl:
                validated.verifiedCanonicalUrl ??
                `paasha://hackathon/${validated.paashaId}`,
              excerpt: validated.rejectionOrHoldReason,
            },
          ],
        }),
        ruleGatePassed: validated.matchable,
        classificationReason: validated.rejectionOrHoldReason,
        reviewStatus: candReviewStatus,
        warningsJson: JSON.stringify(
          validated.shouldPublishToCatalog
            ? []
            : [validated.rejectionOrHoldReason]
        ),
      })
      .onConflictDoUpdate({
        target: schema.eventCandidates.candidateUid,
        set: {
          duplicateOfHackathonSlug: linkedSlug,
          updatesExistingHackathonSlug: matchedExisting?.slug ?? null,
          title: validated.title,
          organizer: validated.organizer,
          eventType: validated.eventType,
          matchable: validated.matchable,
          description: validated.description,
          startAt: validated.startAt,
          endAt: validated.endAt,
          registrationDeadline: validated.registrationDeadline,
          campus: validated.campus,
          venueName: validated.venueName,
          minTeamSize: validated.minTeamSize,
          maxTeamSize: validated.maxTeamSize,
          registrationUrl: validated.registrationUrl,
          verifiedCanonicalUrl: validated.verifiedCanonicalUrl,
          ruleGatePassed: validated.matchable,
          classificationReason: validated.rejectionOrHoldReason,
          reviewStatus: candReviewStatus,
        },
      });
  }

  return summary;
}

export interface DatabaseReconciliationReport {
  executed: boolean;
  totalRowsInspected: number;
  duplicateRowsConsolidated: Array<{
    removedOrArchivedSlug: string;
    mergedIntoSlug: string;
    title: string;
  }>;
  verifiedTeamHackathons: Array<{
    slug: string;
    name: string;
    eventType: EventType;
    minTeamSize: number | null;
    maxTeamSize: number | null;
  }>;
  unknownTeamEligibilityHackathons: Array<{
    slug: string;
    name: string;
    eventType: EventType;
  }>;
  nonHackathonRecords: Array<{
    slug: string;
    name: string;
    eventType: EventType;
  }>;
  rowsUpdatedCount: number;
}

/**
 * Audits and reconciles all rows in `schema.hackathons` (with dry-run support when `execute: false`):
 * 1. Consolidates multi-page duplicates (`ADCOM 2027` across `pes_event_11537` and `pes_event_11523`,
 *    and duplicate `Triverse Ideathon` pages) while preserving foreign keys.
 * 2. Extracts grounded team sizes from descriptions (`MarTechHack26`, `Hackathon 2026`,
 *    `Nimbus 1000 Hackathon`, `HEAL-A-Thon 2026`, `Agentathon 2025`, `Algomania 2.0`, etc.).
 * 3. Ensures events with unknown team eligibility (`teamParticipationVerified === false`) are
 *    marked `matchable: false` and `verificationStatus: 'unconfirmed_constraints'`.
 * 4. Ensures all non-hackathon records (`tech_talk`, `workshop`, `conference`, `other`) have
 *    accurate `eventType`, `matchable: false`, and `status: 'archived'`.
 */
export async function reconcileExistingHackathonsDatabase(options: {
  execute: boolean;
}): Promise<DatabaseReconciliationReport> {
  const allRows = await db
    .select()
    .from(schema.hackathons)
    .orderBy(schema.hackathons.id);

  const duplicateRowsConsolidated: DatabaseReconciliationReport['duplicateRowsConsolidated'] =
    [];
  const verifiedTeamHackathons: DatabaseReconciliationReport['verifiedTeamHackathons'] =
    [];
  const unknownTeamEligibilityHackathons: DatabaseReconciliationReport['unknownTeamEligibilityHackathons'] =
    [];
  const nonHackathonRecords: DatabaseReconciliationReport['nonHackathonRecords'] =
    [];
  let rowsUpdatedCount = 0;

  // Group rows by real-world event identity
  const canonicalGroups: Array<{
    primary: typeof schema.hackathons.$inferSelect;
    duplicates: Array<typeof schema.hackathons.$inferSelect>;
  }> = [];

  for (const row of allRows) {
    const existingGroup = canonicalGroups.find((g) =>
      areEventsSameRealWorldEvent(
        {
          title: g.primary.name,
          description: g.primary.description,
          startAt: g.primary.startAt,
          endAt: g.primary.endAt,
          organizer: g.primary.organizer,
          verifiedCanonicalUrl: g.primary.verifiedCanonicalUrl,
          originalSubmissionUrl: g.primary.originalSubmissionUrl,
          registrationUrl: g.primary.registrationUrl,
        },
        {
          title: row.name,
          description: row.description,
          startAt: row.startAt,
          endAt: row.endAt,
          organizer: row.organizer,
          verifiedCanonicalUrl: row.verifiedCanonicalUrl,
          originalSubmissionUrl: row.originalSubmissionUrl,
          registrationUrl: row.registrationUrl,
        }
      )
    );

    if (!existingGroup) {
      canonicalGroups.push({ primary: row, duplicates: [] });
    } else {
      // Prefer `pes_event_11537` for ADCOM 2027 ("31st International Advanced Computing and Communication Conference")
      if (
        /31st international advanced computing/i.test(row.name) &&
        !/31st international advanced computing/i.test(existingGroup.primary.name)
      ) {
        existingGroup.duplicates.push(existingGroup.primary);
        existingGroup.primary = row;
      } else {
        existingGroup.duplicates.push(row);
      }
    }
  }

  for (const group of canonicalGroups) {
    const primary = group.primary;
    const dups = group.duplicates;

    const cleanName = cleanHtmlToText(primary.name);
    const cleanDesc = cleanHtmlToText(primary.description);
    const rawThemes = safeJsonParse<string[]>(primary.themesJson, []);
    const { themes: cleanedThemes } = cleanStoredEventThemes(rawThemes);

    let cleanRegUrl = primary.registrationUrl ?? null;
    if (cleanRegUrl) {
      const lower = cleanRegUrl.toLowerCase();
      if (
        lower.includes('me-qr.com/page/blog') ||
        lower.includes('pesuacademy.com') ||
        (primary.verifiedCanonicalUrl &&
          cleanRegUrl === primary.verifiedCanonicalUrl &&
          lower.includes('events.pes.edu/'))
      ) {
        cleanRegUrl = null;
      }
    }

    const states = evaluateHackathonEligibilityAndStates({
      name: cleanName,
      description: cleanDesc,
      eventType: primary.eventType,
      themes: cleanedThemes.filter((t) => t !== 'PESU Event'),
      minTeamSize: primary.minTeamSize,
      maxTeamSize: primary.maxTeamSize,
      startAt: primary.startAt,
      endAt: primary.endAt,
      registrationDeadline: primary.registrationDeadline,
      registrationUrl: cleanRegUrl,
      verifiedCanonicalUrl: primary.verifiedCanonicalUrl,
      originalSubmissionUrl: primary.originalSubmissionUrl,
      sourceUrlStatus: primary.sourceUrlStatus,
      sourceType: primary.slug.startsWith('pes_event_')
        ? 'pes_public_events'
        : undefined,
      status: 'published', // Evaluate intrinsic hackathon status regardless of previous archived state
    });

    if (!states.isHackathon) {
      nonHackathonRecords.push({
        slug: primary.slug,
        name: cleanName,
        eventType: states.eventType,
      });
    } else if (states.teamParticipationVerified) {
      verifiedTeamHackathons.push({
        slug: primary.slug,
        name: cleanName,
        eventType: states.eventType,
        minTeamSize: states.minTeamSize,
        maxTeamSize: states.maxTeamSize,
      });
    } else {
      unknownTeamEligibilityHackathons.push({
        slug: primary.slug,
        name: cleanName,
        eventType: states.eventType,
      });
    }

    const existingProv = safeJsonParse<Record<string, any>>(
      primary.fieldProvenanceJson,
      {}
    );
    const prevUrls = Array.isArray(existingProv?._meta?.allSourceUrls)
      ? (existingProv._meta.allSourceUrls as string[])
      : [];
    const mergedSourceUrls = Array.from(
      new Set(
        [
          ...prevUrls,
          primary.verifiedCanonicalUrl,
          ...dups.map((d) => d.verifiedCanonicalUrl),
        ].filter((u): u is string => Boolean(u && u.trim()))
      )
    );

    const targetStatus: EventLifecycleStatus = states.isHackathon
      ? 'published'
      : 'archived';
    const targetVerificationStatus =
      states.teamParticipationVerified &&
      states.minTeamSize !== null &&
      states.maxTeamSize !== null
        ? 'verified'
        : 'unconfirmed_constraints';

    const needsUpdate =
      primary.eventType !== states.eventType ||
      primary.matchable !== states.matchable ||
      primary.minTeamSize !== states.minTeamSize ||
      primary.maxTeamSize !== states.maxTeamSize ||
      primary.registrationUrl !== cleanRegUrl ||
      primary.status !== targetStatus ||
      primary.verificationStatus !== targetVerificationStatus ||
      dups.length > 0;

    if (needsUpdate) {
      rowsUpdatedCount += 1;
      if (options.execute) {
        const updatedProv = {
          ...existingProv,
          _meta: {
            ...(existingProv._meta ?? {}),
            allSourceUrls: mergedSourceUrls,
            verifiedAt: new Date().toISOString(),
          },
        };
        await db
          .update(schema.hackathons)
          .set({
            name: cleanName,
            description: cleanDesc,
            eventType: states.eventType,
            matchable: states.matchable,
            themesJson: JSON.stringify(cleanedThemes),
            minTeamSize: states.minTeamSize,
            maxTeamSize: states.maxTeamSize,
            registrationUrl: cleanRegUrl,
            ruleGatePassed: states.matchable,
            classificationReason: states.classificationReason,
            verificationStatus: targetVerificationStatus,
            status: targetStatus,
            fieldProvenanceJson: JSON.stringify(updatedProv),
          })
          .where(eq(schema.hackathons.slug, primary.slug));
      }
    }

    for (const dup of dups) {
      duplicateRowsConsolidated.push({
        removedOrArchivedSlug: dup.slug,
        mergedIntoSlug: primary.slug,
        title: cleanHtmlToText(dup.name),
      });
      if (options.execute) {
        await relinkHackathonForeignKeys(dup.slug, primary.slug);
        await db
          .delete(schema.hackathons)
          .where(eq(schema.hackathons.slug, dup.slug));
      }
    }
  }

  return {
    executed: options.execute,
    totalRowsInspected: allRows.length,
    duplicateRowsConsolidated,
    verifiedTeamHackathons,
    unknownTeamEligibilityHackathons,
    nonHackathonRecords,
    rowsUpdatedCount,
  };
}

export function computeTeamRegistrationReadiness(params: {
  memberCount: number;
  minTeamSize?: number | null;
  maxTeamSize?: number | null;
  hackathonStatus?: string | null;
  registrationDeadline?: string | null;
  matchable?: boolean | null;
}): {
  minRequiredMembers: number;
  maxAllowedMembers: number;
  isEligibleToRegister: boolean;
  computedStatus: TeamRegistrationStatus;
  readinessReason: string;
} {
  const maxAllowedMembers = Math.min(
    4,
    params.maxTeamSize && params.maxTeamSize > 0 ? params.maxTeamSize : 4
  );
  const minRequiredMembers = Math.min(
    maxAllowedMembers,
    Math.max(1, params.minTeamSize && params.minTeamSize > 0 ? params.minTeamSize : 2)
  );

  if (
    params.hackathonStatus === 'registration_closed' ||
    params.hackathonStatus === 'completed' ||
    params.hackathonStatus === 'archived'
  ) {
    return {
      minRequiredMembers,
      maxAllowedMembers,
      isEligibleToRegister: false,
      computedStatus: 'registration_closed',
      readinessReason: 'Official registration for this event has closed.',
    };
  }

  if (params.matchable === false) {
    return {
      minRequiredMembers,
      maxAllowedMembers,
      isEligibleToRegister: false,
      computedStatus: 'forming',
      readinessReason: 'This event does not support team registration.',
    };
  }

  if (params.memberCount < minRequiredMembers) {
    const needed = minRequiredMembers - params.memberCount;
    return {
      minRequiredMembers,
      maxAllowedMembers,
      isEligibleToRegister: false,
      computedStatus: 'forming',
      readinessReason: `Add ${needed} more ${
        needed === 1 ? 'member' : 'members'
      } to reach the minimum team size of ${minRequiredMembers}.`,
    };
  }

  if (params.memberCount > maxAllowedMembers) {
    return {
      minRequiredMembers,
      maxAllowedMembers,
      isEligibleToRegister: false,
      computedStatus: 'forming',
      readinessReason: `Team size (${params.memberCount}) exceeds the maximum allowed (${maxAllowedMembers}).`,
    };
  }

  return {
    minRequiredMembers,
    maxAllowedMembers,
    isEligibleToRegister: true,
    computedStatus: 'ready_to_register',
    readinessReason: `Team roster (${params.memberCount}/${maxAllowedMembers}) meets verified team size requirements (${minRequiredMembers}–${maxAllowedMembers} members). Ready for official registration.`,
  };
}

export function buildTeamRegistrationDomainObject(params: {
  team: Team;
  hackathon?: Hackathon | null;
  regRow?: typeof schema.teamRegistrations.$inferSelect | null;
}): TeamRegistration {
  const { team, hackathon, regRow } = params;
  const readiness = computeTeamRegistrationReadiness({
    memberCount: team.memberCount,
    minTeamSize: hackathon?.minTeamSize,
    maxTeamSize: hackathon?.maxTeamSize ?? team.targetSize,
    hackathonStatus: hackathon?.status,
    registrationDeadline: hackathon?.registrationDeadline,
    matchable: hackathon?.matchable,
  });

  let effectiveStatus: TeamRegistrationStatus = readiness.computedStatus;
  if (regRow) {
    if (regRow.registrationStatus === 'registered') {
      effectiveStatus = 'registered';
    } else if (
      regRow.registrationStatus === 'registration_in_progress' &&
      readiness.isEligibleToRegister
    ) {
      effectiveStatus = 'registration_in_progress';
    } else if (regRow.registrationStatus === 'registration_closed') {
      effectiveStatus = 'registration_closed';
    }
  }

  const officialUrl =
    regRow?.officialRegistrationUrl ||
    hackathon?.registrationUrl ||
    hackathon?.verifiedCanonicalUrl ||
    hackathon?.originalSubmissionUrl ||
    null;

  return {
    teamId: team.id,
    hackathonId: team.hackathonId,
    registrationStatus: effectiveStatus,
    officialRegistrationUrl: officialUrl,
    externalRegistrationReference:
      regRow?.externalRegistrationReference ?? null,
    confirmationNotes: regRow?.confirmationNotes ?? null,
    registeredByUid: regRow?.registeredByUid ?? null,
    registeredAt: regRow?.registeredAt
      ? regRow.registeredAt.toISOString()
      : null,
    minRequiredMembers: readiness.minRequiredMembers,
    maxAllowedMembers: readiness.maxAllowedMembers,
    currentMemberCount: team.memberCount,
    isEligibleToRegister: readiness.isEligibleToRegister,
    readinessReason:
      effectiveStatus === 'registered'
        ? `Officially registered${
            regRow?.externalRegistrationReference
              ? ` (Ref: ${regRow.externalRegistrationReference})`
              : ''
          }. Roster changes are locked unless registration is amended.`
        : readiness.readinessReason,
    updatedAt: regRow?.updatedAt
      ? regRow.updatedAt.toISOString()
      : team.createdAt,
  };
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
    await ensureMatchingAndTeamSchema();
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
      // If the existing active membership was from an untouched auto-created 2-person match team
      // and a caller explicitly invokes POST /api/teams (e.g. legacy explicit team creation flow),
      // dissolve the auto-created team so the explicit team can be created; otherwise reject with 409.
      const existingTeamSlug = existingMember[0].teamSlug;
      if (existingTeamSlug.startsWith('team_auto_')) {
        await db
          .delete(schema.memberships)
          .where(eq(schema.memberships.teamSlug, existingTeamSlug));
        await db
          .delete(schema.teamRegistrations)
          .where(eq(schema.teamRegistrations.teamSlug, existingTeamSlug));
        await db
          .delete(schema.conversations)
          .where(eq(schema.conversations.teamSlug, existingTeamSlug));
        await db
          .delete(schema.teams)
          .where(eq(schema.teams.teamSlug, existingTeamSlug));
      } else {
        throw new Error(
          'ALREADY_IN_TEAM: You are already in an active team for this hackathon.'
        );
      }
    }

    const hackRows = await db
      .select()
      .from(schema.hackathons)
      .where(eq(schema.hackathons.slug, params.hackathonSlug));
    const hack = hackRows[0];
    assertHackathonEligibleForTeamFormation(hack);
    const maxCap = Math.min(
      4,
      hack?.maxTeamSize != null && hack.maxTeamSize > 0 ? hack.maxTeamSize : 4
    );
    const clampedTargetSize = Math.min(params.targetSize || maxCap, maxCap);

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
      .onConflictDoUpdate({
        target: schema.memberships.membershipKey,
        set: {
          teamSlug,
          role: 'Team Lead',
          status: 'active',
          joinedAt: new Date(),
        },
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
      .onConflictDoUpdate({
        target: schema.conversations.conversationUid,
        set: {
          participantUidsJson: JSON.stringify([params.leaderUid]),
          lastMessageAt: new Date(),
        },
      })
      .returning();

    const readiness = computeTeamRegistrationReadiness({
      memberCount: 1,
      minTeamSize: hack?.minTeamSize,
      maxTeamSize: hack?.maxTeamSize ?? clampedTargetSize,
      hackathonStatus: hack?.status,
      registrationDeadline: hack?.registrationDeadline,
      matchable: hack?.matchable,
    });

    await db
      .insert(schema.teamRegistrations)
      .values({
        teamSlug,
        hackathonSlug: params.hackathonSlug,
        registrationStatus: readiness.computedStatus,
        officialRegistrationUrl:
          hack?.registrationUrl ?? hack?.verifiedCanonicalUrl ?? null,
      })
      .onConflictDoNothing();

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
        error.message.startsWith('INELIGIBLE_EVENT:'))
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
  autoCreatedTeam?: Team;
  autoCreatedMemberships?: Membership[];
  teamRosterConversation?: Conversation;
  teamProposal?: TeamProposal;
  joinRequest?: JoinRequest;
  initialMessage?: Message;
}> {
  try {
    await ensureMatchingAndTeamSchema();

    if (params.targetType === 'user' && params.fromUid === params.targetId) {
      throw new Error('SELF_SWIPE: You cannot swipe on your own profile.');
    }

    if (params.targetType === 'user') {
      const blockRows = await db
        .select()
        .from(schema.userBlocks)
        .where(
          or(
            and(
              eq(schema.userBlocks.blockerUid, params.fromUid),
              eq(schema.userBlocks.blockedUid, params.targetId)
            ),
            and(
              eq(schema.userBlocks.blockerUid, params.targetId),
              eq(schema.userBlocks.blockedUid, params.fromUid)
            )
          )
        );
      if (blockRows.length > 0) {
        throw new Error('BLOCKED_USER: Cannot interact with a blocked student.');
      }
    }

    const hackRows = await db
      .select()
      .from(schema.hackathons)
      .where(eq(schema.hackathons.slug, params.hackathonSlug));
    const hack = hackRows[0];
    assertHackathonEligibleForTeamFormation(hack);

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

    // Legacy Case A: Swiping right on an open Team -> create a JoinRequest application
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

    // Case B: Student-to-Student Swipe (Part B — Mutual Matching, Automatic 2-Person Team Creation & Growing Existing Teams)
    return await db.transaction(async (tx) => {
      // Find active memberships in this hackathon for both fromUid and targetId
      const activeMemberRows = await tx
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.hackathonSlug, params.hackathonSlug),
            eq(schema.memberships.status, 'active')
          )
        );

      const fromMembership = activeMemberRows.find(
        (m) => m.uid === params.fromUid
      );
      const targetMembership = activeMemberRows.find(
        (m) => m.uid === params.targetId
      );

      // Check direct reverse interest (targetId -> fromUid)
      const directReverseKey = `${params.hackathonSlug}_${params.targetId}_user_${params.fromUid}`;
      const directReverseRows = await tx
        .select()
        .from(schema.swipes)
        .where(
          and(
            eq(schema.swipes.swipeKey, directReverseKey),
            eq(schema.swipes.decision, 'interested')
          )
        );

      // Also check if either student is on a team and the unassigned student swiped right on ANY member of that team,
      // OR a member of that team swiped right on the unassigned student
      let teamMemberReciprocalUid: string | null =
        directReverseRows.length > 0 ? params.fromUid : null;
      let recruitingTeamSlug: string | null = null;
      let candidateUidForProposal: string | null = null;
      let proposerUidForProposal: string | null = null;

      if (fromMembership && !targetMembership) {
        recruitingTeamSlug = fromMembership.teamSlug;
        candidateUidForProposal = params.targetId;
        proposerUidForProposal = params.fromUid;

        if (!teamMemberReciprocalUid) {
          // Did targetId swipe right on any member of fromUid's team?
          const teamMemberUids = activeMemberRows
            .filter((m) => m.teamSlug === fromMembership.teamSlug)
            .map((m) => m.uid);
          const candidateSwipesOnTeam = await tx
            .select()
            .from(schema.swipes)
            .where(
              and(
                eq(schema.swipes.hackathonSlug, params.hackathonSlug),
                eq(schema.swipes.fromUid, params.targetId),
                eq(schema.swipes.targetType, 'user'),
                inArray(schema.swipes.targetId, teamMemberUids),
                eq(schema.swipes.decision, 'interested')
              )
            );
          if (candidateSwipesOnTeam.length > 0) {
            teamMemberReciprocalUid = candidateSwipesOnTeam[0].targetId;
          }
        }
      } else if (!fromMembership && targetMembership) {
        recruitingTeamSlug = targetMembership.teamSlug;
        candidateUidForProposal = params.fromUid;
        proposerUidForProposal = params.targetId;

        if (!teamMemberReciprocalUid) {
          // Did any member of targetId's team swipe right on fromUid?
          const teamMemberUids = activeMemberRows
            .filter((m) => m.teamSlug === targetMembership.teamSlug)
            .map((m) => m.uid);
          const teamSwipesOnCandidate = await tx
            .select()
            .from(schema.swipes)
            .where(
              and(
                eq(schema.swipes.hackathonSlug, params.hackathonSlug),
                inArray(schema.swipes.fromUid, teamMemberUids),
                eq(schema.swipes.targetType, 'user'),
                eq(schema.swipes.targetId, params.fromUid),
                eq(schema.swipes.decision, 'interested')
              )
            );
          if (teamSwipesOnCandidate.length > 0) {
            teamMemberReciprocalUid = teamSwipesOnCandidate[0].fromUid;
            proposerUidForProposal = teamMemberReciprocalUid;
          }
        }
      }

      const isMutualMatch =
        directReverseRows.length > 0 || Boolean(teamMemberReciprocalUid);

      if (!isMutualMatch) {
        return { interest };
      }

      // 1. Always create/update direct_match conversation between the two students
      const sortedPair = [params.fromUid, params.targetId].sort();
      const conversationUid = `conv_match_${params.hackathonSlug}_${sortedPair[0]}_${sortedPair[1]}`;

      const userRows = await tx
        .select()
        .from(schema.users)
        .where(inArray(schema.users.uid, sortedPair));
      const fromUser = userRows.find((u) => u.uid === params.fromUid);
      const toUser = userRows.find((u) => u.uid === params.targetId);
      const title = `${fromUser?.displayName ?? params.fromUid} ↔ ${
        toUser?.displayName ?? params.targetId
      }`;

      const [convRow] = await tx
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

      const mutualMatchConversation: Conversation = {
        id: convRow.conversationUid,
        hackathonId: convRow.hackathonSlug,
        type: 'direct_match',
        title: convRow.title,
        participantUids: sortedPair,
        createdAt: convRow.createdAt.toISOString(),
        lastMessageAt: convRow.lastMessageAt.toISOString(),
      };

      let initialMessage: Message | undefined;
      if (params.note && params.note.trim()) {
        const messageUid = `msg_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const [msgRow] = await tx
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

      const maxCap = Math.min(
        4,
        hack?.maxTeamSize != null && hack.maxTeamSize > 0 ? hack.maxTeamSize : 4
      );

      // 2. Subcase 2A: Neither student is on a team for this hackathon -> Automatically create a 2-person team!
      if (!fromMembership && !targetMembership && maxCap >= 2) {
        const teamSlug = `team_auto_${params.hackathonSlug}_${sortedPair[0]}_${sortedPair[1]}`;
        const firstNameA = (fromUser?.displayName ?? 'Builder').split(' ')[0];
        const firstNameB = (toUser?.displayName ?? 'Builder').split(' ')[0];
        const teamName = `${firstNameA} & ${firstNameB}'s Team`;
        const teamStatus: 'open' | 'full' = 2 >= maxCap ? 'full' : 'open';

        const profileRows = await tx
          .select()
          .from(schema.profiles)
          .where(inArray(schema.profiles.uid, sortedPair));
        const combinedDomains = Array.from(
          new Set([
            ...profileRows.flatMap((p) =>
              safeJsonParse<string[]>(p.interestTagsJson, [])
            ),
            ...(hack ? safeJsonParse<string[]>(hack.themesJson, []) : []),
          ])
        ).slice(0, 5);

        const [teamRow] = await tx
          .insert(schema.teams)
          .values({
            teamSlug,
            hackathonSlug: params.hackathonSlug,
            leaderUid: sortedPair[0],
            name: teamName,
            pitch: `Matched on Quackathon for ${
              hack?.name ?? params.hackathonSlug
            }.`,
            projectIdea: null,
            rolesNeededJson: JSON.stringify([
              'Frontend / UI',
              'Backend / APIs',
              'AI / ML',
              'Product & UI/UX',
            ]),
            customSpecializationsJson: '[]',
            desiredDomainsJson: JSON.stringify(combinedDomains),
            availabilitySummary: 'Flexible schedule',
            workStyleTagsJson: '[]',
            targetSize: maxCap,
            memberCount: 2,
            status: teamStatus,
          })
          .onConflictDoUpdate({
            target: schema.teams.teamSlug,
            set: {
              memberCount: 2,
              status: teamStatus,
            },
          })
          .returning();

        const now = new Date();
        const [memA] = await tx
          .insert(schema.memberships)
          .values({
            membershipKey: `${params.hackathonSlug}_${sortedPair[0]}`,
            hackathonSlug: params.hackathonSlug,
            teamSlug,
            uid: sortedPair[0],
            role: 'Co-Founder',
            status: 'active',
            joinedAt: now,
          })
          .onConflictDoUpdate({
            target: schema.memberships.membershipKey,
            set: {
              teamSlug,
              role: 'Co-Founder',
              status: 'active',
              joinedAt: now,
            },
          })
          .returning();

        const [memB] = await tx
          .insert(schema.memberships)
          .values({
            membershipKey: `${params.hackathonSlug}_${sortedPair[1]}`,
            hackathonSlug: params.hackathonSlug,
            teamSlug,
            uid: sortedPair[1],
            role: 'Co-Founder',
            status: 'active',
            joinedAt: now,
          })
          .onConflictDoUpdate({
            target: schema.memberships.membershipKey,
            set: {
              teamSlug,
              role: 'Co-Founder',
              status: 'active',
              joinedAt: now,
            },
          })
          .returning();

        const rosterConvUid = `conv_${teamSlug}`;
        const [rosterConvRow] = await tx
          .insert(schema.conversations)
          .values({
            conversationUid: rosterConvUid,
            hackathonSlug: params.hackathonSlug,
            type: 'team_roster',
            title: `${teamName} — Team Chat`,
            participantUidsJson: JSON.stringify(sortedPair),
            teamSlug,
          })
          .onConflictDoUpdate({
            target: schema.conversations.conversationUid,
            set: {
              participantUidsJson: JSON.stringify(sortedPair),
              lastMessageAt: now,
            },
          })
          .returning();

        const readiness = computeTeamRegistrationReadiness({
          memberCount: 2,
          minTeamSize: hack?.minTeamSize,
          maxTeamSize: hack?.maxTeamSize ?? maxCap,
          hackathonStatus: hack?.status,
          registrationDeadline: hack?.registrationDeadline,
          matchable: hack?.matchable,
        });

        await tx
          .insert(schema.teamRegistrations)
          .values({
            teamSlug,
            hackathonSlug: params.hackathonSlug,
            registrationStatus: readiness.computedStatus,
            officialRegistrationUrl:
              hack?.registrationUrl ?? hack?.verifiedCanonicalUrl ?? null,
          })
          .onConflictDoUpdate({
            target: schema.teamRegistrations.teamSlug,
            set: {
              registrationStatus: readiness.computedStatus,
              updatedAt: now,
            },
          });

        // Expire any pending proposals where either student was a candidate for another team in this hackathon
        await tx
          .update(schema.teamProposals)
          .set({
            status: 'expired',
            resolutionNote:
              'Candidate formed a new 2-person team via mutual match.',
            resolvedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.teamProposals.hackathonSlug, params.hackathonSlug),
              inArray(schema.teamProposals.candidateUid, sortedPair),
              inArray(schema.teamProposals.status, ['pending_votes', 'invited'])
            )
          );

        const autoCreatedTeam: Team = {
          id: teamRow.teamSlug,
          hackathonId: teamRow.hackathonSlug,
          leaderId: teamRow.leaderUid,
          name: teamRow.name,
          pitch: teamRow.pitch,
          projectIdea: teamRow.projectIdea ?? undefined,
          rolesNeeded: safeJsonParse<string[]>(teamRow.rolesNeededJson, []),
          desiredDomains: safeJsonParse<string[]>(
            teamRow.desiredDomainsJson,
            []
          ),
          availabilitySummary: teamRow.availabilitySummary,
          workStyleTags: safeJsonParse<string[]>(teamRow.workStyleTagsJson, []),
          targetSize: teamRow.targetSize,
          memberCount: teamRow.memberCount,
          status: teamStatus,
          visibility: 'public',
          createdAt: teamRow.createdAt.toISOString(),
        };

        const autoCreatedMemberships: Membership[] = [memA, memB].map((m) => ({
          id: m.membershipKey,
          hackathonId: m.hackathonSlug,
          teamId: m.teamSlug,
          uid: m.uid,
          role: m.role,
          joinedAt: m.joinedAt.toISOString(),
          status: 'active',
        }));

        const teamRosterConversation: Conversation = {
          id: rosterConvRow.conversationUid,
          hackathonId: rosterConvRow.hackathonSlug,
          type: 'team_roster',
          title: rosterConvRow.title,
          participantUids: sortedPair,
          teamId: teamSlug,
          createdAt: rosterConvRow.createdAt.toISOString(),
          lastMessageAt: rosterConvRow.lastMessageAt.toISOString(),
        };

        return {
          interest,
          mutualMatchConversation,
          autoCreatedTeam,
          autoCreatedMemberships,
          teamRosterConversation,
          initialMessage,
        };
      }

      // 3. Subcase 2B: One student is on an existing team and the other student has no team -> Create a TeamProposal!
      if (
        recruitingTeamSlug &&
        candidateUidForProposal &&
        proposerUidForProposal
      ) {
        const teamRows = await tx
          .select()
          .from(schema.teams)
          .where(eq(schema.teams.teamSlug, recruitingTeamSlug))
          .for('update');
        const recTeam = teamRows[0];

        const regRows = await tx
          .select()
          .from(schema.teamRegistrations)
          .where(eq(schema.teamRegistrations.teamSlug, recruitingTeamSlug));
        const isRegisteredLocked =
          regRows[0]?.registrationStatus === 'registered';

        const effectiveCap = recTeam
          ? Math.min(maxCap, recTeam.targetSize || maxCap)
          : maxCap;

        if (
          recTeam &&
          recTeam.status === 'open' &&
          recTeam.memberCount < effectiveCap &&
          !isRegisteredLocked
        ) {
          const teamActiveMemberUids = Array.from(
            new Set([
              recTeam.leaderUid,
              ...activeMemberRows
                .filter((m) => m.teamSlug === recruitingTeamSlug)
                .map((m) => m.uid),
            ])
          );

          const proposalUid = `prop_${params.hackathonSlug}_${recruitingTeamSlug}_${candidateUidForProposal}`;
          const now = new Date();

          // Record the proposer's approval vote automatically
          const voteKey = `${proposalUid}_${proposerUidForProposal}`;
          await tx
            .insert(schema.teamProposalVotes)
            .values({
              voteKey,
              proposalUid,
              teamSlug: recruitingTeamSlug,
              voterUid: proposerUidForProposal,
              decision: 'approve',
              comment: 'Initiated via mutual interest swipe',
              votedAt: now,
            })
            .onConflictDoUpdate({
              target: schema.teamProposalVotes.voteKey,
              set: {
                decision: 'approve',
                votedAt: now,
              },
            });

          // Check all existing votes on this proposal
          const existingVotes = await tx
            .select()
            .from(schema.teamProposalVotes)
            .where(eq(schema.teamProposalVotes.proposalUid, proposalUid));

          const hasRejection = existingVotes.some(
            (v) =>
              v.decision === 'reject' &&
              teamActiveMemberUids.includes(v.voterUid)
          );
          const approvedCount = teamActiveMemberUids.filter((mUid) =>
            existingVotes.some(
              (v) => v.voterUid === mUid && v.decision === 'approve'
            )
          ).length;

          const allApproved =
            !hasRejection && approvedCount >= teamActiveMemberUids.length;
          const nextProposalStatus: TeamProposalStatus = hasRejection
            ? 'rejected'
            : allApproved
            ? 'invited'
            : 'pending_votes';

          const [propRow] = await tx
            .insert(schema.teamProposals)
            .values({
              proposalUid,
              hackathonSlug: params.hackathonSlug,
              teamSlug: recruitingTeamSlug,
              candidateUid: candidateUidForProposal,
              proposedByUid: proposerUidForProposal,
              proposedRole: params.proposedRole || 'Core Builder',
              message:
                params.note ||
                `Mutual match with ${recTeam.name}! Awaiting unanimous team approval.`,
              status: nextProposalStatus,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: schema.teamProposals.proposalUid,
              set: {
                status: nextProposalStatus,
                updatedAt: now,
              },
            })
            .returning();

          const teamProposal: TeamProposal = {
            id: propRow.proposalUid,
            hackathonId: propRow.hackathonSlug,
            teamId: propRow.teamSlug,
            teamName: recTeam.name,
            candidateUid: propRow.candidateUid,
            proposedByUid: propRow.proposedByUid,
            proposedRole: propRow.proposedRole,
            message: propRow.message ?? undefined,
            status: nextProposalStatus,
            votes: existingVotes.map((vr) => ({
              id: vr.voteKey,
              proposalId: vr.proposalUid,
              teamId: vr.teamSlug,
              voterUid: vr.voterUid,
              decision: (vr.decision as 'approve' | 'reject') || 'approve',
              comment: vr.comment ?? undefined,
              votedAt: vr.votedAt.toISOString(),
            })),
            requiredVoterUids: teamActiveMemberUids,
            approvedCount,
            requiredCount: teamActiveMemberUids.length,
            createdAt: propRow.createdAt.toISOString(),
            updatedAt: propRow.updatedAt.toISOString(),
          };

          return {
            interest,
            mutualMatchConversation,
            teamProposal,
            initialMessage,
          };
        }
      }

      return {
        interest,
        mutualMatchConversation,
        initialMessage,
      };
    });
  } catch (error) {
    console.error('Database error in recordSwipeAndProcessMatchRecord:', error);
    if (
      error instanceof Error &&
      /^(TEAM_FULL|SELF_SWIPE|BLOCKED_USER|INELIGIBLE_EVENT):/.test(
        error.message
      )
    ) {
      throw error;
    }
    throw new Error('Failed to record swipe decision.', { cause: error });
  }
}

export async function createTeamProposalRecord(params: {
  hackathonSlug: string;
  teamSlug: string;
  proposerUid: string;
  candidateUid: string;
  proposedRole?: string;
  message?: string;
}): Promise<TeamProposal> {
  await ensureMatchingAndTeamSchema();
  if (params.proposerUid === params.candidateUid) {
    throw new Error('INVALID_PROPOSAL: Cannot propose yourself.');
  }

  return await db.transaction(async (tx) => {
    const teamRows = await tx
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.teamSlug, params.teamSlug))
      .for('update');
    const teamRow = teamRows[0];
    if (!teamRow) {
      throw new Error('NOT_FOUND: Team not found.');
    }

    const regRows = await tx
      .select()
      .from(schema.teamRegistrations)
      .where(eq(schema.teamRegistrations.teamSlug, params.teamSlug));
    if (regRows[0]?.registrationStatus === 'registered') {
      throw new Error(
        'TEAM_REGISTERED_LOCKED: Cannot add candidates to a team that has already completed official registration.'
      );
    }

    const hackRows = await tx
      .select()
      .from(schema.hackathons)
      .where(eq(schema.hackathons.slug, teamRow.hackathonSlug));
    const hack = hackRows[0];
    const maxCap = Math.min(
      4,
      hack?.maxTeamSize != null && hack.maxTeamSize > 0
        ? Math.min(teamRow.targetSize, hack.maxTeamSize)
        : teamRow.targetSize
    );

    if (teamRow.memberCount >= maxCap || teamRow.status !== 'open') {
      throw new Error(
        `TEAM_FULL: Team "${teamRow.name}" has already reached maximum capacity (${maxCap}).`
      );
    }

    const memberRows = await tx
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.hackathonSlug, teamRow.hackathonSlug),
          eq(schema.memberships.status, 'active')
        )
      );

    const teamActiveMemberUids = Array.from(
      new Set([
        teamRow.leaderUid,
        ...memberRows
          .filter((m) => m.teamSlug === teamRow.teamSlug)
          .map((m) => m.uid),
      ])
    );

    if (!teamActiveMemberUids.includes(params.proposerUid)) {
      throw new Error(
        'FORBIDDEN: Only active members of this team can propose a candidate.'
      );
    }

    const candidateExistingMembership = memberRows.find(
      (m) => m.uid === params.candidateUid
    );
    if (candidateExistingMembership) {
      throw new Error(
        'ALREADY_IN_TEAM: Candidate is already an active member of a team for this hackathon.'
      );
    }

    const proposalUid = `prop_${teamRow.hackathonSlug}_${teamRow.teamSlug}_${params.candidateUid}`;
    const existingProps = await tx
      .select()
      .from(schema.teamProposals)
      .where(eq(schema.teamProposals.proposalUid, proposalUid));
    if (
      existingProps[0] &&
      (existingProps[0].status === 'pending_votes' ||
        existingProps[0].status === 'invited')
    ) {
      throw new Error(
        'DUPLICATE_PROPOSAL: An active proposal already exists for this candidate and team.'
      );
    }

    const now = new Date();
    // Clear any old votes if a previous proposal was expired/rejected and is being recreated
    await tx
      .delete(schema.teamProposalVotes)
      .where(eq(schema.teamProposalVotes.proposalUid, proposalUid));

    const voteKey = `${proposalUid}_${params.proposerUid}`;
    const [voteRow] = await tx
      .insert(schema.teamProposalVotes)
      .values({
        voteKey,
        proposalUid,
        teamSlug: teamRow.teamSlug,
        voterUid: params.proposerUid,
        decision: 'approve',
        comment: params.message ?? 'Proposed candidate',
        votedAt: now,
      })
      .returning();

    const initialStatus: TeamProposalStatus =
      teamActiveMemberUids.length <= 1 ? 'invited' : 'pending_votes';

    const [propRow] = await tx
      .insert(schema.teamProposals)
      .values({
        proposalUid,
        hackathonSlug: teamRow.hackathonSlug,
        teamSlug: teamRow.teamSlug,
        candidateUid: params.candidateUid,
        proposedByUid: params.proposerUid,
        proposedRole: params.proposedRole || 'Core Builder',
        message: params.message ?? null,
        status: initialStatus,
        resolutionNote: null,
        createdAt: now,
        updatedAt: now,
        resolvedAt: null,
      })
      .onConflictDoUpdate({
        target: schema.teamProposals.proposalUid,
        set: {
          proposedByUid: params.proposerUid,
          proposedRole: params.proposedRole || 'Core Builder',
          message: params.message ?? null,
          status: initialStatus,
          resolutionNote: null,
          updatedAt: now,
          resolvedAt: null,
        },
      })
      .returning();

    return {
      id: propRow.proposalUid,
      hackathonId: propRow.hackathonSlug,
      teamId: propRow.teamSlug,
      teamName: teamRow.name,
      candidateUid: propRow.candidateUid,
      proposedByUid: propRow.proposedByUid,
      proposedRole: propRow.proposedRole,
      message: propRow.message ?? undefined,
      status: initialStatus,
      votes: [
        {
          id: voteRow.voteKey,
          proposalId: voteRow.proposalUid,
          teamId: voteRow.teamSlug,
          voterUid: voteRow.voterUid,
          decision: 'approve',
          comment: voteRow.comment ?? undefined,
          votedAt: voteRow.votedAt.toISOString(),
        },
      ],
      requiredVoterUids: teamActiveMemberUids,
      approvedCount: 1,
      requiredCount: teamActiveMemberUids.length,
      createdAt: propRow.createdAt.toISOString(),
      updatedAt: propRow.updatedAt.toISOString(),
    };
  });
}

export async function voteOnTeamProposalRecord(params: {
  proposalUid: string;
  voterUid: string;
  decision: 'approve' | 'reject';
  comment?: string;
}): Promise<{
  proposal: TeamProposal;
  unanimouslyApproved: boolean;
}> {
  await ensureMatchingAndTeamSchema();
  return await db.transaction(async (tx) => {
    const initialProps = await tx
      .select()
      .from(schema.teamProposals)
      .where(eq(schema.teamProposals.proposalUid, params.proposalUid))
      .limit(1);
    if (!initialProps[0]) {
      throw new Error('NOT_FOUND: Team proposal not found.');
    }

    const teamRows = await tx
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.teamSlug, initialProps[0].teamSlug))
      .for('update');
    const teamRow = teamRows[0];
    if (!teamRow) {
      throw new Error('NOT_FOUND: Team not found.');
    }

    const propRows = await tx
      .select()
      .from(schema.teamProposals)
      .where(eq(schema.teamProposals.proposalUid, params.proposalUid))
      .for('update');
    const propRow = propRows[0];
    if (!propRow) {
      throw new Error('NOT_FOUND: Team proposal not found.');
    }

    if (propRow.status !== 'pending_votes' && propRow.status !== 'invited') {
      throw new Error(
        `ALREADY_RESOLVED: Proposal is already ${propRow.status}.`
      );
    }

    const activeMemberRows = await tx
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.teamSlug, teamRow.teamSlug),
          eq(schema.memberships.status, 'active')
        )
      );

    const requiredVoterUids = Array.from(
      new Set([teamRow.leaderUid, ...activeMemberRows.map((m) => m.uid)])
    );

    if (!requiredVoterUids.includes(params.voterUid)) {
      throw new Error(
        'FORBIDDEN: Only current active members of this team can vote on candidate proposals.'
      );
    }

    const now = new Date();
    const voteKey = `${params.proposalUid}_${params.voterUid}`;

    await tx
      .insert(schema.teamProposalVotes)
      .values({
        voteKey,
        proposalUid: params.proposalUid,
        teamSlug: teamRow.teamSlug,
        voterUid: params.voterUid,
        decision: params.decision,
        comment: params.comment ?? null,
        votedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.teamProposalVotes.voteKey,
        set: {
          decision: params.decision,
          comment: params.comment ?? null,
          votedAt: now,
        },
      });

    const allVotes = await tx
      .select()
      .from(schema.teamProposalVotes)
      .where(eq(schema.teamProposalVotes.proposalUid, params.proposalUid));

    if (params.decision === 'reject') {
      const [rejectedRow] = await tx
        .update(schema.teamProposals)
        .set({
          status: 'rejected',
          resolutionNote:
            params.comment || 'Rejected by team member vote (unanimity required).',
          updatedAt: now,
          resolvedAt: now,
        })
        .where(eq(schema.teamProposals.proposalUid, params.proposalUid))
        .returning();

      const approvedCount = requiredVoterUids.filter((uid) =>
        allVotes.some((v) => v.voterUid === uid && v.decision === 'approve')
      ).length;

      return {
        unanimouslyApproved: false,
        proposal: {
          id: rejectedRow.proposalUid,
          hackathonId: rejectedRow.hackathonSlug,
          teamId: rejectedRow.teamSlug,
          teamName: teamRow.name,
          candidateUid: rejectedRow.candidateUid,
          proposedByUid: rejectedRow.proposedByUid,
          proposedRole: rejectedRow.proposedRole,
          message: rejectedRow.message ?? undefined,
          status: 'rejected',
          resolutionNote: rejectedRow.resolutionNote ?? undefined,
          votes: allVotes.map((vr) => ({
            id: vr.voteKey,
            proposalId: vr.proposalUid,
            teamId: vr.teamSlug,
            voterUid: vr.voterUid,
            decision: (vr.decision as 'approve' | 'reject') || 'approve',
            comment: vr.comment ?? undefined,
            votedAt: vr.votedAt.toISOString(),
          })),
          requiredVoterUids,
          approvedCount,
          requiredCount: requiredVoterUids.length,
          createdAt: rejectedRow.createdAt.toISOString(),
          updatedAt: rejectedRow.updatedAt.toISOString(),
          resolvedAt: now.toISOString(),
        },
      };
    }

    // Check if every current active member has voted 'approve'
    const approvedCount = requiredVoterUids.filter((uid) =>
      allVotes.some((v) => v.voterUid === uid && v.decision === 'approve')
    ).length;
    const anyRejected = allVotes.some(
      (v) => v.decision === 'reject' && requiredVoterUids.includes(v.voterUid)
    );
    const unanimouslyApproved =
      !anyRejected && approvedCount >= requiredVoterUids.length;

    const nextStatus: TeamProposalStatus = unanimouslyApproved
      ? 'invited'
      : 'pending_votes';

    const [updatedPropRow] = await tx
      .update(schema.teamProposals)
      .set({
        status: nextStatus,
        updatedAt: now,
      })
      .where(eq(schema.teamProposals.proposalUid, params.proposalUid))
      .returning();

    return {
      unanimouslyApproved,
      proposal: {
        id: updatedPropRow.proposalUid,
        hackathonId: updatedPropRow.hackathonSlug,
        teamId: updatedPropRow.teamSlug,
        teamName: teamRow.name,
        candidateUid: updatedPropRow.candidateUid,
        proposedByUid: updatedPropRow.proposedByUid,
        proposedRole: updatedPropRow.proposedRole,
        message: updatedPropRow.message ?? undefined,
        status: nextStatus,
        resolutionNote: updatedPropRow.resolutionNote ?? undefined,
        votes: allVotes.map((vr) => ({
          id: vr.voteKey,
          proposalId: vr.proposalUid,
          teamId: vr.teamSlug,
          voterUid: vr.voterUid,
          decision: (vr.decision as 'approve' | 'reject') || 'approve',
          comment: vr.comment ?? undefined,
          votedAt: vr.votedAt.toISOString(),
        })),
        requiredVoterUids,
        approvedCount,
        requiredCount: requiredVoterUids.length,
        createdAt: updatedPropRow.createdAt.toISOString(),
        updatedAt: updatedPropRow.updatedAt.toISOString(),
      },
    };
  });
}

export async function respondToTeamProposalRecord(params: {
  proposalUid: string;
  candidateUid: string;
  decision: 'accept' | 'decline';
}): Promise<{
  proposal: TeamProposal;
  team?: Team;
  membership?: Membership;
  conversation?: Conversation;
  becomesFull?: boolean;
}> {
  await ensureMatchingAndTeamSchema();
  try {
    return await db.transaction(async (tx) => {
      const initialProps = await tx
        .select()
        .from(schema.teamProposals)
        .where(eq(schema.teamProposals.proposalUid, params.proposalUid))
        .limit(1);
      if (!initialProps[0]) {
        throw new Error('NOT_FOUND: Team proposal not found.');
      }

      const teamRows = await tx
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.teamSlug, initialProps[0].teamSlug))
        .for('update');
      const teamRow = teamRows[0];
      if (!teamRow) {
        throw new Error('NOT_FOUND: Team not found.');
      }

      const propRows = await tx
        .select()
        .from(schema.teamProposals)
        .where(eq(schema.teamProposals.proposalUid, params.proposalUid))
        .for('update');
      const propRow = propRows[0];
      if (!propRow) {
        throw new Error('NOT_FOUND: Team proposal not found.');
      }

      if (propRow.candidateUid !== params.candidateUid) {
        throw new Error(
          'FORBIDDEN: Only the invited candidate can accept or decline this team invitation.'
        );
      }

      const allVotes = await tx
        .select()
        .from(schema.teamProposalVotes)
        .where(eq(schema.teamProposalVotes.proposalUid, params.proposalUid));

      const activeMemberRows = await tx
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.teamSlug, teamRow.teamSlug),
            eq(schema.memberships.status, 'active')
          )
        );
      const requiredVoterUids = Array.from(
        new Set([teamRow.leaderUid, ...activeMemberRows.map((m) => m.uid)])
      );
      const approvedCount = requiredVoterUids.filter((uid) =>
        allVotes.some((v) => v.voterUid === uid && v.decision === 'approve')
      ).length;

      const now = new Date();

      if (params.decision === 'decline') {
        const [declinedRow] = await tx
          .update(schema.teamProposals)
          .set({
            status: 'declined',
            resolutionNote: 'Declined by candidate.',
            updatedAt: now,
            resolvedAt: now,
          })
          .where(eq(schema.teamProposals.proposalUid, params.proposalUid))
          .returning();

        return {
          proposal: {
            id: declinedRow.proposalUid,
            hackathonId: declinedRow.hackathonSlug,
            teamId: declinedRow.teamSlug,
            teamName: teamRow.name,
            candidateUid: declinedRow.candidateUid,
            proposedByUid: declinedRow.proposedByUid,
            proposedRole: declinedRow.proposedRole,
            message: declinedRow.message ?? undefined,
            status: 'declined',
            resolutionNote: declinedRow.resolutionNote ?? undefined,
            votes: allVotes.map((vr) => ({
              id: vr.voteKey,
              proposalId: vr.proposalUid,
              teamId: vr.teamSlug,
              voterUid: vr.voterUid,
              decision: (vr.decision as 'approve' | 'reject') || 'approve',
              comment: vr.comment ?? undefined,
              votedAt: vr.votedAt.toISOString(),
            })),
            requiredVoterUids,
            approvedCount,
            requiredCount: requiredVoterUids.length,
            createdAt: declinedRow.createdAt.toISOString(),
            updatedAt: declinedRow.updatedAt.toISOString(),
            resolvedAt: now.toISOString(),
          },
        };
      }

      if (propRow.status === 'pending_votes') {
        throw new Error(
          'UNANIMOUS_APPROVAL_REQUIRED: Every current team member must approve before you can join the team.'
        );
      }

      if (propRow.status !== 'invited') {
        throw new Error(
          `ALREADY_RESOLVED: Invitation is no longer active (current status: ${propRow.status}).`
        );
      }

      // Check if team is locked by completed registration
      const regRows = await tx
        .select()
        .from(schema.teamRegistrations)
        .where(eq(schema.teamRegistrations.teamSlug, teamRow.teamSlug));
      if (regRows[0]?.registrationStatus === 'registered') {
        throw new Error(
          'TEAM_REGISTERED_LOCKED: This team has already completed official hackathon registration. Roster changes are locked unless registration is amended.'
        );
      }

      // Check team capacity (max 4 or verified maxTeamSize)
      const hackRows = await tx
        .select()
        .from(schema.hackathons)
        .where(eq(schema.hackathons.slug, teamRow.hackathonSlug));
      const hack = hackRows[0];
      const maxCap = Math.min(
        4,
        hack?.maxTeamSize != null && hack.maxTeamSize > 0
          ? Math.min(teamRow.targetSize, hack.maxTeamSize)
          : teamRow.targetSize
      );

      if (teamRow.memberCount >= maxCap || teamRow.status !== 'open') {
        throw new Error(
          `TEAM_FULL: Team "${teamRow.name}" has already reached maximum capacity (${maxCap}).`
        );
      }

      // Verify candidate is not already in another active team for this hackathon
      const membershipKey = `${teamRow.hackathonSlug}_${params.candidateUid}`;
      const existingCandidateMember = await tx
        .select()
        .from(schema.memberships)
        .where(
          and(
            eq(schema.memberships.membershipKey, membershipKey),
            eq(schema.memberships.status, 'active')
          )
        );
      if (existingCandidateMember.length > 0) {
        throw new Error(
          'ALREADY_IN_TEAM: You are already an active member of a team for this hackathon.'
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
          hackathonSlug: teamRow.hackathonSlug,
          teamSlug: teamRow.teamSlug,
          uid: params.candidateUid,
          role: propRow.proposedRole || 'Core Builder',
          status: 'active',
          joinedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.memberships.membershipKey,
          set: {
            teamSlug: teamRow.teamSlug,
            role: propRow.proposedRole || 'Core Builder',
            status: 'active',
            joinedAt: now,
          },
        })
        .returning();

      const [acceptedPropRow] = await tx
        .update(schema.teamProposals)
        .set({
          status: 'accepted',
          resolutionNote: 'Accepted by candidate.',
          updatedAt: now,
          resolvedAt: now,
        })
        .where(eq(schema.teamProposals.proposalUid, params.proposalUid))
        .returning();

      // Invalidate any competing proposals/invitations for this candidate in the same hackathon
      await tx
        .update(schema.teamProposals)
        .set({
          status: 'expired',
          resolutionNote:
            'Candidate accepted an invitation from another team in this hackathon.',
          updatedAt: now,
          resolvedAt: now,
        })
        .where(
          and(
            eq(schema.teamProposals.hackathonSlug, teamRow.hackathonSlug),
            eq(schema.teamProposals.candidateUid, params.candidateUid),
            ne(schema.teamProposals.proposalUid, params.proposalUid),
            inArray(schema.teamProposals.status, ['pending_votes', 'invited'])
          )
        );

      // If team reached capacity, expire all remaining pending proposals and join requests for this team
      if (becomesFull) {
        await tx
          .update(schema.teamProposals)
          .set({
            status: 'expired',
            resolutionNote: 'Auto-expired because team reached maximum capacity.',
            updatedAt: now,
            resolvedAt: now,
          })
          .where(
            and(
              eq(schema.teamProposals.teamSlug, teamRow.teamSlug),
              ne(schema.teamProposals.proposalUid, params.proposalUid),
              inArray(schema.teamProposals.status, ['pending_votes', 'invited'])
            )
          );

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
      const nextParticipants = Array.from(
        new Set([...requiredVoterUids, params.candidateUid])
      );
      const rosterConvUid = `conv_${teamRow.teamSlug}`;
      const [convRow] = await tx
        .insert(schema.conversations)
        .values({
          conversationUid: rosterConvUid,
          hackathonSlug: teamRow.hackathonSlug,
          type: 'team_roster',
          title: `${teamRow.name} — Team Chat`,
          participantUidsJson: JSON.stringify(nextParticipants),
          teamSlug: teamRow.teamSlug,
        })
        .onConflictDoUpdate({
          target: schema.conversations.conversationUid,
          set: {
            participantUidsJson: JSON.stringify(nextParticipants),
            lastMessageAt: now,
          },
        })
        .returning();

      // Update team registration readiness
      const readiness = computeTeamRegistrationReadiness({
        memberCount: newCount,
        minTeamSize: hack?.minTeamSize,
        maxTeamSize: hack?.maxTeamSize ?? maxCap,
        hackathonStatus: hack?.status,
        registrationDeadline: hack?.registrationDeadline,
        matchable: hack?.matchable,
      });

      await tx
        .insert(schema.teamRegistrations)
        .values({
          teamSlug: teamRow.teamSlug,
          hackathonSlug: teamRow.hackathonSlug,
          registrationStatus: readiness.computedStatus,
          officialRegistrationUrl:
            hack?.registrationUrl ?? hack?.verifiedCanonicalUrl ?? null,
        })
        .onConflictDoUpdate({
          target: schema.teamRegistrations.teamSlug,
          set: {
            registrationStatus:
              regRows[0]?.registrationStatus === 'registration_in_progress' &&
              readiness.isEligibleToRegister
                ? 'registration_in_progress'
                : readiness.computedStatus,
            updatedAt: now,
          },
        });

      const specs = safeJsonParse<string[]>(
        updatedTeamRow.customSpecializationsJson,
        []
      );

      return {
        becomesFull,
        proposal: {
          id: acceptedPropRow.proposalUid,
          hackathonId: acceptedPropRow.hackathonSlug,
          teamId: acceptedPropRow.teamSlug,
          teamName: updatedTeamRow.name,
          candidateUid: acceptedPropRow.candidateUid,
          proposedByUid: acceptedPropRow.proposedByUid,
          proposedRole: acceptedPropRow.proposedRole,
          message: acceptedPropRow.message ?? undefined,
          status: 'accepted',
          resolutionNote: acceptedPropRow.resolutionNote ?? undefined,
          votes: allVotes.map((vr) => ({
            id: vr.voteKey,
            proposalId: vr.proposalUid,
            teamId: vr.teamSlug,
            voterUid: vr.voterUid,
            decision: (vr.decision as 'approve' | 'reject') || 'approve',
            comment: vr.comment ?? undefined,
            votedAt: vr.votedAt.toISOString(),
          })),
          requiredVoterUids: nextParticipants,
          approvedCount,
          requiredCount: requiredVoterUids.length,
          createdAt: acceptedPropRow.createdAt.toISOString(),
          updatedAt: acceptedPropRow.updatedAt.toISOString(),
          resolvedAt: now.toISOString(),
        },
        team: {
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
        membership: {
          id: newMemberRow.membershipKey,
          hackathonId: newMemberRow.hackathonSlug,
          teamId: newMemberRow.teamSlug,
          uid: newMemberRow.uid,
          role: newMemberRow.role,
          joinedAt: newMemberRow.joinedAt.toISOString(),
          status: 'active',
        },
        conversation: {
          id: convRow.conversationUid,
          hackathonId: convRow.hackathonSlug,
          type: 'team_roster',
          title: convRow.title,
          participantUids: nextParticipants,
          teamId: teamRow.teamSlug,
          createdAt: convRow.createdAt.toISOString(),
          lastMessageAt: convRow.lastMessageAt.toISOString(),
        },
      };
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('TEAM_FULL:')) {
      await db
        .update(schema.teamProposals)
        .set({
          status: 'expired',
          resolutionNote: 'Team reached maximum capacity.',
          resolvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.teamProposals.proposalUid, params.proposalUid),
            inArray(schema.teamProposals.status, ['pending_votes', 'invited'])
          )
        )
        .catch(() => {});
      throw error;
    }
    throw error;
  }
}

export async function leaveTeamRecord(params: {
  teamSlug: string;
  uid: string;
}): Promise<{
  team: Team;
  leftMembership: Membership;
  remainingMemberUids: string[];
}> {
  await ensureMatchingAndTeamSchema();
  return await db.transaction(async (tx) => {
    const teamRows = await tx
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.teamSlug, params.teamSlug))
      .for('update');
    const teamRow = teamRows[0];
    if (!teamRow) {
      throw new Error('NOT_FOUND: Team not found.');
    }

    const regRows = await tx
      .select()
      .from(schema.teamRegistrations)
      .where(eq(schema.teamRegistrations.teamSlug, params.teamSlug));
    if (regRows[0]?.registrationStatus === 'registered') {
      throw new Error(
        'TEAM_REGISTERED_LOCKED: This team is already marked as officially registered. Amend or unlock registration status before changing team roster.'
      );
    }

    const activeMemberRows = await tx
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.teamSlug, params.teamSlug),
          eq(schema.memberships.status, 'active')
        )
      );

    const memberRow = activeMemberRows.find((m) => m.uid === params.uid);
    if (!memberRow) {
      throw new Error('FORBIDDEN: You are not an active member of this team.');
    }

    const now = new Date();
    const [updatedMemberRow] = await tx
      .update(schema.memberships)
      .set({ status: 'left' })
      .where(eq(schema.memberships.id, memberRow.id))
      .returning();

    const remainingMembers = activeMemberRows.filter(
      (m) => m.uid !== params.uid
    );
    const remainingMemberUids = remainingMembers.map((m) => m.uid);
    const newCount = remainingMembers.length;

    const hackRows = await tx
      .select()
      .from(schema.hackathons)
      .where(eq(schema.hackathons.slug, teamRow.hackathonSlug));
    const hack = hackRows[0];
    const maxCap = Math.min(
      4,
      hack?.maxTeamSize != null && hack.maxTeamSize > 0
        ? Math.min(teamRow.targetSize, hack.maxTeamSize)
        : teamRow.targetSize
    );

    const nextLeaderUid =
      newCount === 0
        ? teamRow.leaderUid
        : teamRow.leaderUid === params.uid
        ? remainingMemberUids[0]
        : teamRow.leaderUid;

    const nextTeamStatus: 'open' | 'full' | 'locked' =
      newCount === 0 ? 'locked' : newCount >= maxCap ? 'full' : 'open';

    const [updatedTeamRow] = await tx
      .update(schema.teams)
      .set({
        leaderUid: nextLeaderUid,
        memberCount: newCount,
        status: nextTeamStatus,
      })
      .where(eq(schema.teams.teamSlug, params.teamSlug))
      .returning();

    // Update team_roster conversation participants
    const convRows = await tx
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.teamSlug, params.teamSlug));
    if (convRows[0]) {
      await tx
        .update(schema.conversations)
        .set({
          participantUidsJson: JSON.stringify(remainingMemberUids),
          lastMessageAt: now,
        })
        .where(
          eq(schema.conversations.conversationUid, convRows[0].conversationUid)
        );
    }

    // Re-evaluate pending_votes proposals for this team:
    // If newCount === 0, expire them. Otherwise, if all remaining active members have approved a pending proposal, transition it to 'invited'.
    if (newCount === 0) {
      await tx
        .update(schema.teamProposals)
        .set({
          status: 'expired',
          resolutionNote: 'Team dissolved because all members left.',
          updatedAt: now,
          resolvedAt: now,
        })
        .where(
          and(
            eq(schema.teamProposals.teamSlug, params.teamSlug),
            inArray(schema.teamProposals.status, ['pending_votes', 'invited'])
          )
        );
    } else {
      const pendingProps = await tx
        .select()
        .from(schema.teamProposals)
        .where(
          and(
            eq(schema.teamProposals.teamSlug, params.teamSlug),
            eq(schema.teamProposals.status, 'pending_votes')
          )
        );
      for (const pp of pendingProps) {
        const votes = await tx
          .select()
          .from(schema.teamProposalVotes)
          .where(eq(schema.teamProposalVotes.proposalUid, pp.proposalUid));
        const allRemainingApproved = remainingMemberUids.every((mUid) =>
          votes.some((v) => v.voterUid === mUid && v.decision === 'approve')
        );
        if (allRemainingApproved) {
          await tx
            .update(schema.teamProposals)
            .set({ status: 'invited', updatedAt: now })
            .where(eq(schema.teamProposals.proposalUid, pp.proposalUid));
        }
      }
    }

    // Update team registration readiness
    const readiness = computeTeamRegistrationReadiness({
      memberCount: newCount,
      minTeamSize: hack?.minTeamSize,
      maxTeamSize: hack?.maxTeamSize ?? maxCap,
      hackathonStatus: hack?.status,
      registrationDeadline: hack?.registrationDeadline,
      matchable: hack?.matchable,
    });

    await tx
      .insert(schema.teamRegistrations)
      .values({
        teamSlug: params.teamSlug,
        hackathonSlug: teamRow.hackathonSlug,
        registrationStatus: readiness.computedStatus,
        officialRegistrationUrl:
          hack?.registrationUrl ?? hack?.verifiedCanonicalUrl ?? null,
      })
      .onConflictDoUpdate({
        target: schema.teamRegistrations.teamSlug,
        set: {
          registrationStatus: readiness.computedStatus,
          updatedAt: now,
        },
      });

    const specs = safeJsonParse<string[]>(
      updatedTeamRow.customSpecializationsJson,
      []
    );

    return {
      remainingMemberUids,
      team: {
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
        status: nextTeamStatus,
        visibility: 'public',
        createdAt: updatedTeamRow.createdAt.toISOString(),
      },
      leftMembership: {
        id: updatedMemberRow.membershipKey,
        hackathonId: updatedMemberRow.hackathonSlug,
        teamId: updatedMemberRow.teamSlug,
        uid: updatedMemberRow.uid,
        role: updatedMemberRow.role,
        joinedAt: updatedMemberRow.joinedAt.toISOString(),
        status: 'left',
      },
    };
  });
}

export async function updateTeamDetailsRecord(params: {
  teamSlug: string;
  actorUid: string;
  name?: string;
  pitch?: string;
  projectIdea?: string | null;
  rolesNeeded?: string[];
  customSpecializations?: string[];
  desiredDomains?: string[];
  targetSize?: number;
}): Promise<Team> {
  await ensureMatchingAndTeamSchema();
  return await db.transaction(async (tx) => {
    const teamRows = await tx
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.teamSlug, params.teamSlug))
      .for('update');
    const teamRow = teamRows[0];
    if (!teamRow) {
      throw new Error('NOT_FOUND: Team not found.');
    }

    const activeMembers = await tx
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.teamSlug, params.teamSlug),
          eq(schema.memberships.status, 'active')
        )
      );
    const isMember =
      teamRow.leaderUid === params.actorUid ||
      activeMembers.some((m) => m.uid === params.actorUid);
    if (!isMember) {
      throw new Error('FORBIDDEN: Only active team members can edit team details.');
    }

    const hackRows = await tx
      .select()
      .from(schema.hackathons)
      .where(eq(schema.hackathons.slug, teamRow.hackathonSlug));
    const hack = hackRows[0];
    const maxCap = Math.min(
      4,
      hack?.maxTeamSize != null && hack.maxTeamSize > 0 ? hack.maxTeamSize : 4
    );

    const nextTargetSize =
      params.targetSize != null
        ? Math.max(
            teamRow.memberCount,
            Math.min(maxCap, Math.max(2, params.targetSize))
          )
        : teamRow.targetSize;

    const nextStatus: 'open' | 'full' | 'locked' =
      teamRow.status === 'locked'
        ? 'locked'
        : teamRow.memberCount >= nextTargetSize
        ? 'full'
        : 'open';

    const nextName = params.name?.trim() || teamRow.name;
    const nextPitch = params.pitch?.trim() ?? teamRow.pitch;
    const nextProjectIdea =
      params.projectIdea !== undefined
        ? params.projectIdea
        : teamRow.projectIdea;
    const nextRolesNeeded =
      params.rolesNeeded ?? safeJsonParse<string[]>(teamRow.rolesNeededJson, []);
    const nextSpecs =
      params.customSpecializations ??
      safeJsonParse<string[]>(teamRow.customSpecializationsJson, []);
    const nextDomains =
      params.desiredDomains ??
      safeJsonParse<string[]>(teamRow.desiredDomainsJson, []);

    const [updated] = await tx
      .update(schema.teams)
      .set({
        name: nextName,
        pitch: nextPitch,
        projectIdea: nextProjectIdea,
        rolesNeededJson: JSON.stringify(nextRolesNeeded),
        customSpecializationsJson: JSON.stringify(nextSpecs),
        desiredDomainsJson: JSON.stringify(nextDomains),
        targetSize: nextTargetSize,
        status: nextStatus,
      })
      .where(eq(schema.teams.teamSlug, params.teamSlug))
      .returning();

    return {
      id: updated.teamSlug,
      hackathonId: updated.hackathonSlug,
      leaderId: updated.leaderUid,
      name: updated.name,
      pitch: updated.pitch,
      projectIdea: updated.projectIdea ?? undefined,
      rolesNeeded: nextRolesNeeded,
      customSpecializations: nextSpecs.length > 0 ? nextSpecs : undefined,
      desiredDomains: nextDomains,
      availabilitySummary: updated.availabilitySummary,
      workStyleTags: safeJsonParse<string[]>(updated.workStyleTagsJson, []),
      targetSize: updated.targetSize,
      memberCount: updated.memberCount,
      status: nextStatus,
      visibility: 'public',
      createdAt: updated.createdAt.toISOString(),
    };
  });
}

export async function updateTeamRegistrationRecord(params: {
  teamSlug: string;
  actorUid: string;
  status: TeamRegistrationStatus;
  externalRegistrationReference?: string | null;
  confirmationNotes?: string | null;
}): Promise<TeamRegistration> {
  await ensureMatchingAndTeamSchema();
  return await db.transaction(async (tx) => {
    const teamRows = await tx
      .select()
      .from(schema.teams)
      .where(eq(schema.teams.teamSlug, params.teamSlug))
      .for('update');
    const teamRow = teamRows[0];
    if (!teamRow) {
      throw new Error('NOT_FOUND: Team not found.');
    }

    const activeMembers = await tx
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.teamSlug, params.teamSlug),
          eq(schema.memberships.status, 'active')
        )
      );
    const isMember =
      teamRow.leaderUid === params.actorUid ||
      activeMembers.some((m) => m.uid === params.actorUid);
    if (!isMember) {
      throw new Error(
        'FORBIDDEN: Only active team members can update registration status.'
      );
    }

    const hackRows = await tx
      .select()
      .from(schema.hackathons)
      .where(eq(schema.hackathons.slug, teamRow.hackathonSlug));
    const hackRow = hackRows[0];
    const hackDomain = hackRow ? mapDbHackathonToDomain(hackRow) : undefined;

    const readiness = computeTeamRegistrationReadiness({
      memberCount: teamRow.memberCount,
      minTeamSize: hackDomain?.minTeamSize,
      maxTeamSize: hackDomain?.maxTeamSize ?? teamRow.targetSize,
      hackathonStatus: hackDomain?.status,
      registrationDeadline: hackDomain?.registrationDeadline,
      matchable: hackDomain?.matchable,
    });

    if (
      (params.status === 'registration_in_progress' ||
        params.status === 'registered') &&
      !readiness.isEligibleToRegister
    ) {
      throw new Error(`INELIGIBLE_TEAM_SIZE: ${readiness.readinessReason}`);
    }

    const now = new Date();
    const officialUrl =
      hackDomain?.registrationUrl ||
      hackDomain?.verifiedCanonicalUrl ||
      hackDomain?.originalSubmissionUrl ||
      null;

    const [regRow] = await tx
      .insert(schema.teamRegistrations)
      .values({
        teamSlug: params.teamSlug,
        hackathonSlug: teamRow.hackathonSlug,
        registrationStatus: params.status,
        officialRegistrationUrl: officialUrl,
        externalRegistrationReference:
          params.externalRegistrationReference ?? null,
        confirmationNotes: params.confirmationNotes ?? null,
        registeredByUid:
          params.status === 'registered' ? params.actorUid : null,
        registeredAt: params.status === 'registered' ? now : null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: schema.teamRegistrations.teamSlug,
        set: {
          registrationStatus: params.status,
          officialRegistrationUrl: officialUrl,
          externalRegistrationReference:
            params.externalRegistrationReference !== undefined
              ? params.externalRegistrationReference
              : undefined,
          confirmationNotes:
            params.confirmationNotes !== undefined
              ? params.confirmationNotes
              : undefined,
          registeredByUid:
            params.status === 'registered' ? params.actorUid : null,
          registeredAt: params.status === 'registered' ? now : null,
          updatedAt: now,
        },
      })
      .returning();

    const teamDomain: Team = {
      id: teamRow.teamSlug,
      hackathonId: teamRow.hackathonSlug,
      leaderId: teamRow.leaderUid,
      name: teamRow.name,
      pitch: teamRow.pitch,
      projectIdea: teamRow.projectIdea ?? undefined,
      rolesNeeded: safeJsonParse<string[]>(teamRow.rolesNeededJson, []),
      desiredDomains: safeJsonParse<string[]>(teamRow.desiredDomainsJson, []),
      availabilitySummary: teamRow.availabilitySummary,
      workStyleTags: safeJsonParse<string[]>(teamRow.workStyleTagsJson, []),
      targetSize: teamRow.targetSize,
      memberCount: teamRow.memberCount,
      status: (teamRow.status as 'open' | 'full' | 'locked') || 'open',
      visibility: 'public',
      createdAt: teamRow.createdAt.toISOString(),
    };

    return buildTeamRegistrationDomainObject({
      team: teamDomain,
      hackathon: hackDomain,
      regRow,
    });
  });
}

export async function getShortlistForUserRecord(params: {
  uid: string;
  hackathonSlug: string;
}): Promise<ShortlistPayload> {
  await ensureMatchingAndTeamSchema();
  const [
    userRows,
    profileRows,
    swipeRows,
    memberRows,
    convRows,
    proposalRows,
    blockRows,
  ] = await Promise.all([
    db.select().from(schema.users),
    db.select().from(schema.profiles),
    db
      .select()
      .from(schema.swipes)
      .where(
        and(
          eq(schema.swipes.hackathonSlug, params.hackathonSlug),
          eq(schema.swipes.targetType, 'user')
        )
      ),
    db
      .select()
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.hackathonSlug, params.hackathonSlug),
          eq(schema.memberships.status, 'active')
        )
      ),
    db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.hackathonSlug, params.hackathonSlug)),
    db
      .select()
      .from(schema.teamProposals)
      .where(eq(schema.teamProposals.hackathonSlug, params.hackathonSlug)),
    db
      .select()
      .from(schema.userBlocks)
      .where(
        or(
          eq(schema.userBlocks.blockerUid, params.uid),
          eq(schema.userBlocks.blockedUid, params.uid)
        )
      ),
  ]);

  const blockedUids = new Set(
    blockRows.map((b) =>
      b.blockerUid === params.uid ? b.blockedUid : b.blockerUid
    )
  );

  const userMap = new Map<string, User>();
  for (const ur of userRows) {
    userMap.set(ur.uid, mapDbUserToDomain(ur));
  }
  const profileMap = new Map<string, Profile>();
  for (const pr of profileRows) {
    profileMap.set(pr.uid, mapDbProfileToDomain(pr));
  }

  const viewerMembership = memberRows.find((m) => m.uid === params.uid);
  const viewerTeamSlug = viewerMembership?.teamSlug;

  const outgoingInterested = swipeRows.filter(
    (s) =>
      s.fromUid === params.uid &&
      s.decision === 'interested' &&
      !blockedUids.has(s.targetId)
  );
  const incomingInterested = swipeRows.filter(
    (s) =>
      s.targetId === params.uid &&
      s.decision === 'interested' &&
      !blockedUids.has(s.fromUid)
  );

  const outgoingByTarget = new Map(
    outgoingInterested.map((s) => [s.targetId, s])
  );
  const incomingBySender = new Map(
    incomingInterested.map((s) => [s.fromUid, s])
  );

  const buildEntry = (
    otherUid: string,
    swipedAt: Date
  ): ShortlistEntry | null => {
    const u = userMap.get(otherUid);
    const p = profileMap.get(otherUid);
    if (!u || !p) return null;
    if (
      u.privacyPreferences?.profileVisible === false ||
      p.visibility === 'hidden'
    ) {
      return null;
    }

    const otherMembership = memberRows.find((m) => m.uid === otherUid);
    const isSameTeam =
      Boolean(viewerTeamSlug) && otherMembership?.teamSlug === viewerTeamSlug;

    const isMutual =
      outgoingByTarget.has(otherUid) && incomingBySender.has(otherUid);

    const activeProposal = proposalRows.find(
      (pr) =>
        (pr.candidateUid === otherUid || pr.candidateUid === params.uid) &&
        (pr.teamSlug === viewerTeamSlug ||
          pr.teamSlug === otherMembership?.teamSlug) &&
        (pr.status === 'pending_votes' || pr.status === 'invited')
    );

    const sortedPair = [params.uid, otherUid].sort();
    const matchConvId = `conv_match_${params.hackathonSlug}_${sortedPair[0]}_${sortedPair[1]}`;
    const existingConv = convRows.find((c) => c.conversationUid === matchConvId);

    let status: ShortlistEntry['status'] = 'awaiting_response';
    if (isSameTeam) {
      status = 'in_your_team';
    } else if (activeProposal?.status === 'invited') {
      status = 'proposal_invited';
    } else if (activeProposal?.status === 'pending_votes') {
      status = 'proposal_pending_votes';
    } else if (isMutual) {
      status = 'mutual_match';
    } else if (incomingBySender.has(otherUid) && !outgoingByTarget.has(otherUid)) {
      status = 'interested_in_you';
    }

    return {
      uid: otherUid,
      displayName: u.displayName,
      campus: u.campus,
      program: u.program,
      graduationYear: u.graduationYear,
      headline: p.headline,
      skillTags: p.skillTags,
      interestTags: p.interestTags,
      preferredRoles: p.preferredRoles,
      swipedAt: swipedAt.toISOString(),
      status,
      conversationId: existingConv?.conversationUid,
      teamId: isSameTeam
        ? viewerTeamSlug
        : activeProposal?.teamSlug ?? otherMembership?.teamSlug,
      proposalId: activeProposal?.proposalUid,
    };
  };

  const interested: ShortlistEntry[] = [];
  const interestedInYou: ShortlistEntry[] = [];
  const mutualMatches: ShortlistEntry[] = [];

  for (const out of outgoingInterested) {
    const entry = buildEntry(out.targetId, out.createdAt);
    if (!entry) continue;
    interested.push(entry);
    if (incomingBySender.has(out.targetId)) {
      mutualMatches.push(entry);
    }
  }

  for (const inc of incomingInterested) {
    const entry = buildEntry(inc.fromUid, inc.createdAt);
    if (!entry) continue;
    interestedInYou.push(entry);
  }

  return {
    hackathonId: params.hackathonSlug,
    interested,
    interestedInYou,
    mutualMatches,
  };
}

export async function getTeamMessagesRecord(params: {
  teamSlug: string;
  viewerUid: string;
}): Promise<{
  conversation: Conversation;
  messages: (Message & { senderName?: string })[];
}> {
  await ensureMatchingAndTeamSchema();
  const teamRows = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.teamSlug, params.teamSlug));
  const teamRow = teamRows[0];
  if (!teamRow) {
    throw new Error('NOT_FOUND: Team not found.');
  }

  const activeMembers = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.teamSlug, params.teamSlug),
        eq(schema.memberships.status, 'active')
      )
    );
  const participantUids = Array.from(
    new Set([teamRow.leaderUid, ...activeMembers.map((m) => m.uid)])
  );

  if (!participantUids.includes(params.viewerUid)) {
    throw new Error(
      'FORBIDDEN: Only active members of this team can view team chat messages.'
    );
  }

  const conversationUid = `conv_${params.teamSlug}`;
  let convRows = await db
    .select()
    .from(schema.conversations)
    .where(eq(schema.conversations.conversationUid, conversationUid));
  if (!convRows[0]) {
    convRows = await db
      .insert(schema.conversations)
      .values({
        conversationUid,
        hackathonSlug: teamRow.hackathonSlug,
        type: 'team_roster',
        title: `${teamRow.name} — Team Chat`,
        participantUidsJson: JSON.stringify(participantUids),
        teamSlug: params.teamSlug,
      })
      .returning();
  }
  const convRow = convRows[0];

  const [msgRows, userRows] = await Promise.all([
    db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationUid, conversationUid))
      .orderBy(schema.messages.createdAt),
    db
      .select()
      .from(schema.users)
      .where(inArray(schema.users.uid, participantUids)),
  ]);

  const nameByUid = new Map(userRows.map((u) => [u.uid, u.displayName]));

  return {
    conversation: {
      id: convRow.conversationUid,
      hackathonId: convRow.hackathonSlug,
      type: 'team_roster',
      title: convRow.title,
      participantUids,
      teamId: params.teamSlug,
      createdAt: convRow.createdAt.toISOString(),
      lastMessageAt: convRow.lastMessageAt.toISOString(),
    },
    messages: msgRows.map((m) => ({
      id: m.messageUid,
      conversationId: m.conversationUid,
      senderUid: m.senderUid,
      senderName: nameByUid.get(m.senderUid) ?? m.senderUid,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      moderationStatus: 'clean',
    })),
  };
}

export async function createTeamMessageRecord(params: {
  teamSlug: string;
  senderUid: string;
  body: string;
}): Promise<Message & { senderName?: string }> {
  await ensureMatchingAndTeamSchema();
  const trimmed = params.body?.trim() ?? '';
  if (!trimmed) {
    throw new Error('EMPTY_MESSAGE: Message body cannot be empty.');
  }

  const teamRows = await db
    .select()
    .from(schema.teams)
    .where(eq(schema.teams.teamSlug, params.teamSlug));
  const teamRow = teamRows[0];
  if (!teamRow) {
    throw new Error('NOT_FOUND: Team not found.');
  }

  const activeMembers = await db
    .select()
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.teamSlug, params.teamSlug),
        eq(schema.memberships.status, 'active')
      )
    );
  const participantUids = Array.from(
    new Set([teamRow.leaderUid, ...activeMembers.map((m) => m.uid)])
  );

  if (!participantUids.includes(params.senderUid)) {
    throw new Error(
      'FORBIDDEN: Only active members of this team can send team chat messages.'
    );
  }

  const now = new Date();
  const conversationUid = `conv_${params.teamSlug}`;
  await db
    .insert(schema.conversations)
    .values({
      conversationUid,
      hackathonSlug: teamRow.hackathonSlug,
      type: 'team_roster',
      title: `${teamRow.name} — Team Chat`,
      participantUidsJson: JSON.stringify(participantUids),
      teamSlug: params.teamSlug,
      lastMessageAt: now,
    })
    .onConflictDoUpdate({
      target: schema.conversations.conversationUid,
      set: {
        participantUidsJson: JSON.stringify(participantUids),
        lastMessageAt: now,
      },
    });

  const messageUid = `msg_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const [msgRow] = await db
    .insert(schema.messages)
    .values({
      messageUid,
      conversationUid,
      senderUid: params.senderUid,
      body: trimmed,
      createdAt: now,
    })
    .returning();

  const senderRows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.uid, params.senderUid));

  return {
    id: msgRow.messageUid,
    conversationId: msgRow.conversationUid,
    senderUid: msgRow.senderUid,
    senderName: senderRows[0]?.displayName ?? msgRow.senderUid,
    body: msgRow.body,
    createdAt: msgRow.createdAt.toISOString(),
    moderationStatus: 'clean',
  };
}

export async function blockUserRecord(params: {
  blockerUid: string;
  blockedUid: string;
  reason?: string;
}): Promise<BlockRecord> {
  await ensureMatchingAndTeamSchema();
  if (params.blockerUid === params.blockedUid) {
    throw new Error('INVALID_BLOCK: Cannot block yourself.');
  }
  const blockKey = `${params.blockerUid}_${params.blockedUid}`;
  const now = new Date();
  const [row] = await db
    .insert(schema.userBlocks)
    .values({
      blockKey,
      blockerUid: params.blockerUid,
      blockedUid: params.blockedUid,
      reason: params.reason ?? null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: schema.userBlocks.blockKey,
      set: { reason: params.reason ?? null },
    })
    .returning();

  return {
    id: row.blockKey,
    blockerUid: row.blockerUid,
    blockedUid: row.blockedUid,
    createdAt: row.createdAt.toISOString(),
  };
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
    return await db.transaction(async (tx) => {
      const initialReqRows = await tx
        .select()
        .from(schema.joinRequests)
        .where(eq(schema.joinRequests.requestUid, params.requestUid))
        .limit(1);
      const initialReq = initialReqRows[0];
      if (!initialReq) {
        throw new Error('NOT_FOUND: Join request not found.');
      }

      const teamRows = await tx
        .select()
        .from(schema.teams)
        .where(eq(schema.teams.teamSlug, initialReq.teamSlug))
        .for('update');
      const teamRow = teamRows[0];
      if (!teamRow) {
        throw new Error('NOT_FOUND: Team not found.');
      }

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
        if (reqRow.status === 'expired') {
          throw new Error('NOT_FOUND: Join request no longer exists.');
        }
        throw new Error(
          `ALREADY_RESOLVED: Join request is already ${reqRow.status}.`
        );
      }

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

      const hackRows = await tx
        .select()
        .from(schema.hackathons)
        .where(eq(schema.hackathons.slug, reqRow.hackathonSlug));
      const hack = hackRows[0];
      const maxCap = Math.min(
        4,
        hack?.maxTeamSize != null
          ? Math.min(teamRow.targetSize, hack.maxTeamSize)
          : teamRow.targetSize
      );

      if (teamRow.memberCount >= maxCap || teamRow.status !== 'open') {
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
          joinedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.memberships.membershipKey,
          set: {
            teamSlug: teamRow.teamSlug,
            role: reqRow.proposedRole,
            status: 'active',
            joinedAt: now,
          },
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

