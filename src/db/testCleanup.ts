import { inArray, like, or } from 'drizzle-orm';
import { db } from './index.ts';
import {
  conversations,
  eventCandidates,
  hackathons,
  joinRequests,
  memberships,
  messages,
  oauthSessions,
  oauthTransactions,
  participations,
  profiles,
  swipes,
  teamProposals,
  teamProposalVotes,
  teamRegistrations,
  teams,
  userBlocks,
  users,
} from './schema.ts';

/**
 * Deterministic identification of test-generated user accounts.
 * Never identifies users merely by numbers in their display name or SRN.
 * Matches only explicit integration-test UID prefixes and fixtures used in `tests/integration.test.ts`.
 */
const TEST_USER_UID_PATTERNS: RegExp[] = [
  /^stu_[a-z]_\d{10,}$/i,
  /^t[12][ab]_\d{10,}$/i,
  /^cand_\d{10,}$/i,
  /^rej_\d{10,}$/i,
  /^pesu_test_[a-z0-9_]+_\d{10,}$/i,
  /^pesu_conc_[a-z0-9_]+_\d{10,}$/i,
  /^pesu_ann_html403_\d{10,}$/i,
  /^test_user_/i,
];

const EXACT_TEST_USER_UIDS = new Set<string>([
  'student_submitter_dup_test',
  'admin_reviewer_dup_test',
  'pesu_pesu_multi_inst_user',
  'pesu_pesu_lifecycle_user',
  'u_solo_arjun',
]);

/**
 * Deterministic identification of synthetic test hackathons & event candidates.
 * Never identifies events merely because their titles contain numbers
 * (e.g., "2090 V3.0", "KODIKON 6.0", "Nimbus 2000", "Algomania 3.0" are genuine PESU events).
 */
const TEST_HACKATHON_SLUG_PATTERNS: RegExp[] = [
  /^hack_pes_flagship_hackathon_\d+/i,
  /^hack_competing_teams_hackathon_\d+/i,
  /^hack_pes_real_systems_hackathon_2026_/i,
  /^hack_concurrency_systems_hackathon_/i,
  /^hack_aegis_cyber_ctf_security_hackathon_2026_/i,
  /^hack_pes_systems_ai_hackathon_2026_/i,
  /^hack_test_/i,
  /^hack_terrapthon_26$/i,
  /^pes_event_999\d+$/i,
];

const TEST_EVENT_URL_PATTERNS: RegExp[] = [
  /^https?:\/\/events\.pes\.edu\/quack-overhaul-\d+/i,
  /^https?:\/\/events\.pes\.edu\/competing-teams-\d+/i,
  /^https?:\/\/events\.pes\.edu\/real-hack-2026\/?$/i,
  /^https?:\/\/events\.pes\.edu\/999\d+\/?$/i,
  /^https?:\/\/events\.pes\.edu\/pes-ai-2026\/?$/i,
  /^https?:\/\/events\.pes\.edu\/rust-seminar\/?$/i,
];

const TEST_EVENT_TITLE_PATTERNS: RegExp[] = [
  /^PES Flagship Hackathon \d{10,}$/i,
  /^Competing Teams Hackathon \d{10,}$/i,
  /^PES Real Systems Hackathon 2026$/i,
  /^Concurrency Systems Hackathon$/i,
  /^Aegis Cyber CTF & Security Hackathon 2026$/i,
  /^PES Systems & AI Hackathon 2026$/i,
];

export function isSyntheticTestUserUid(uid: string | null | undefined): boolean {
  if (!uid) return false;
  const trimmed = uid.trim();
  if (EXACT_TEST_USER_UIDS.has(trimmed)) return true;
  return TEST_USER_UID_PATTERNS.some((re) => re.test(trimmed));
}

export function isSyntheticTestHackathonRecord(record: {
  slug?: string | null;
  id?: string | null;
  name?: string | null;
  title?: string | null;
  verifiedCanonicalUrl?: string | null;
  registrationUrl?: string | null;
  originalSubmissionUrl?: string | null;
  createdByUid?: string | null;
  createdBy?: string | null;
  submittedByUid?: string | null;
}): boolean {
  const slug = (record.slug || record.id || '').trim();
  if (slug && TEST_HACKATHON_SLUG_PATTERNS.some((re) => re.test(slug))) {
    return true;
  }

  const title = (record.name || record.title || '').trim();
  if (title && TEST_EVENT_TITLE_PATTERNS.some((re) => re.test(title))) {
    return true;
  }

  const urls = [
    record.verifiedCanonicalUrl,
    record.registrationUrl,
    record.originalSubmissionUrl,
  ]
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .map((u) => u.trim());

  if (urls.some((u) => TEST_EVENT_URL_PATTERNS.some((re) => re.test(u)))) {
    return true;
  }

  const actor =
    record.createdByUid || record.createdBy || record.submittedByUid || '';
  if (actor && isSyntheticTestUserUid(actor) && !slug.startsWith('pes_event_')) {
    return true;
  }

  return false;
}

export interface TestDataCleanupReport {
  mode: 'dry_run' | 'executed';
  timestamp: string;
  affectedHackathons: {
    slug: string;
    name: string;
    createdByUid: string | null;
    verifiedCanonicalUrl: string | null;
    teamCount: number;
    membershipCount: number;
    conversationCount: number;
    messageCount: number;
    swipeCount: number;
    participationCount: number;
  }[];
  affectedCandidateIds: {
    candidateUid: string;
    title: string;
    submittedByUid: string | null;
    verifiedCanonicalUrl: string | null;
  }[];
  affectedTestUserUids: string[];
  counts: {
    hackathons: number;
    eventCandidates: number;
    users: number;
    profiles: number;
    oauthSessions: number;
    teams: number;
    memberships: number;
    teamProposals: number;
    teamProposalVotes: number;
    teamRegistrations: number;
    joinRequests: number;
    conversations: number;
    messages: number;
    swipes: number;
    participations: number;
  };
}

/**
 * Generates a dry-run report of all synthetic test records in PostgreSQL,
 * and when `execute: true` is passed, deletes them safely in foreign-key order
 * without touching legitimate user or PESU event records.
 */
export async function runTestArtifactsCleanup(options?: {
  execute?: boolean;
}): Promise<TestDataCleanupReport> {
  const execute = Boolean(options?.execute);

  const [
    allUsers,
    allHackathons,
    allCandidates,
    allTeams,
    allMemberships,
    allProposals,
    allProposalVotes,
    allRegistrations,
    allJoinRequests,
    allConversations,
    allMessages,
    allSwipes,
    allParticipations,
    allProfiles,
    allOAuthSessions,
  ] = await Promise.all([
    db.select().from(users),
    db.select().from(hackathons),
    db.select().from(eventCandidates),
    db.select().from(teams),
    db.select().from(memberships),
    db.select().from(teamProposals),
    db.select().from(teamProposalVotes),
    db.select().from(teamRegistrations),
    db.select().from(joinRequests),
    db.select().from(conversations),
    db.select().from(messages),
    db.select().from(swipes),
    db.select().from(participations),
    db.select().from(profiles),
    db.select().from(oauthSessions),
  ]);

  const testUserUidSet = new Set<string>(
    allUsers.filter((u) => isSyntheticTestUserUid(u.uid)).map((u) => u.uid)
  );

  // Also include any test user UIDs referenced in orphaned tables
  for (const p of allParticipations) {
    if (isSyntheticTestUserUid(p.uid)) testUserUidSet.add(p.uid);
  }
  for (const s of allSwipes) {
    if (isSyntheticTestUserUid(s.fromUid)) testUserUidSet.add(s.fromUid);
    if (s.targetType === 'user' && isSyntheticTestUserUid(s.targetId)) {
      testUserUidSet.add(s.targetId);
    }
  }

  const affectedHackathonRows = allHackathons.filter((h) =>
    isSyntheticTestHackathonRecord({
      slug: h.slug,
      name: h.name,
      verifiedCanonicalUrl: h.verifiedCanonicalUrl,
      registrationUrl: h.registrationUrl,
      originalSubmissionUrl: h.originalSubmissionUrl,
      createdByUid: h.createdByUid,
    })
  );
  const testHackathonSlugSet = new Set<string>(
    affectedHackathonRows.map((h) => h.slug)
  );

  // Also include orphaned test hackathon slugs referenced in participations/teams/swipes
  for (const p of allParticipations) {
    if (isSyntheticTestHackathonRecord({ slug: p.hackathonSlug })) {
      testHackathonSlugSet.add(p.hackathonSlug);
    }
  }

  const affectedCandidateRows = allCandidates.filter(
    (c) =>
      !c.candidateUid.startsWith('cand_pes_public_') &&
      (isSyntheticTestHackathonRecord({
        slug: c.candidateUid,
        title: c.title,
        verifiedCanonicalUrl: c.verifiedCanonicalUrl,
        registrationUrl: c.registrationUrl,
        originalSubmissionUrl: c.originalSubmissionUrl,
        submittedByUid: c.submittedByUid,
      }) ||
        (c.duplicateOfHackathonSlug &&
          testHackathonSlugSet.has(c.duplicateOfHackathonSlug)) ||
        (c.updatesExistingHackathonSlug &&
          testHackathonSlugSet.has(c.updatesExistingHackathonSlug)))
  );
  const testCandidateUidSet = new Set<string>(
    affectedCandidateRows.map((c) => c.candidateUid)
  );

  const affectedTeamRows = allTeams.filter(
    (t) =>
      testHackathonSlugSet.has(t.hackathonSlug) ||
      isSyntheticTestUserUid(t.leaderUid)
  );
  const testTeamSlugSet = new Set<string>(
    affectedTeamRows.map((t) => t.teamSlug)
  );

  const affectedMembershipRows = allMemberships.filter(
    (m) =>
      testHackathonSlugSet.has(m.hackathonSlug) ||
      testTeamSlugSet.has(m.teamSlug) ||
      isSyntheticTestUserUid(m.uid)
  );

  const affectedProposalRows = allProposals.filter(
    (p) =>
      testHackathonSlugSet.has(p.hackathonSlug) ||
      testTeamSlugSet.has(p.teamSlug) ||
      isSyntheticTestUserUid(p.candidateUid) ||
      isSyntheticTestUserUid(p.proposedByUid)
  );
  const testProposalUidSet = new Set<string>(
    affectedProposalRows.map((p) => p.proposalUid)
  );

  const affectedProposalVoteRows = allProposalVotes.filter(
    (v) =>
      testProposalUidSet.has(v.proposalUid) ||
      testTeamSlugSet.has(v.teamSlug) ||
      isSyntheticTestUserUid(v.voterUid)
  );

  const affectedRegistrationRows = allRegistrations.filter(
    (r) =>
      testHackathonSlugSet.has(r.hackathonSlug) ||
      testTeamSlugSet.has(r.teamSlug) ||
      isSyntheticTestUserUid(r.registeredByUid)
  );

  const affectedJoinRequestRows = allJoinRequests.filter(
    (jr) =>
      testHackathonSlugSet.has(jr.hackathonSlug) ||
      testTeamSlugSet.has(jr.teamSlug) ||
      isSyntheticTestUserUid(jr.applicantUid) ||
      isSyntheticTestUserUid(jr.initiatorUid)
  );

  const affectedConversationRows = allConversations.filter((c) => {
    if (testHackathonSlugSet.has(c.hackathonSlug)) return true;
    if (c.teamSlug && testTeamSlugSet.has(c.teamSlug)) return true;
    try {
      const uids = JSON.parse(c.participantUidsJson || '[]') as string[];
      if (Array.isArray(uids) && uids.some((u) => isSyntheticTestUserUid(u))) {
        return true;
      }
    } catch {
      // ignore
    }
    return false;
  });
  const testConversationUidSet = new Set<string>(
    affectedConversationRows.map((c) => c.conversationUid)
  );

  const affectedMessageRows = allMessages.filter(
    (m) =>
      testConversationUidSet.has(m.conversationUid) ||
      isSyntheticTestUserUid(m.senderUid)
  );

  const affectedSwipeRows = allSwipes.filter(
    (s) =>
      testHackathonSlugSet.has(s.hackathonSlug) ||
      isSyntheticTestUserUid(s.fromUid) ||
      (s.targetType === 'user' && isSyntheticTestUserUid(s.targetId)) ||
      (s.targetType === 'team' && testTeamSlugSet.has(s.targetId))
  );

  const affectedParticipationRows = allParticipations.filter(
    (p) =>
      testHackathonSlugSet.has(p.hackathonSlug) ||
      isSyntheticTestUserUid(p.uid)
  );

  const affectedProfileRows = allProfiles.filter((p) =>
    testUserUidSet.has(p.uid)
  );
  const affectedSessionRows = allOAuthSessions.filter((s) =>
    testUserUidSet.has(s.uid)
  );

  const affectedHackathonsSummary = affectedHackathonRows.map((h) => {
    const hTeams = affectedTeamRows.filter((t) => t.hackathonSlug === h.slug);
    const hMemberships = affectedMembershipRows.filter(
      (m) => m.hackathonSlug === h.slug
    );
    const hConvs = affectedConversationRows.filter(
      (c) => c.hackathonSlug === h.slug
    );
    const hConvIds = new Set(hConvs.map((c) => c.conversationUid));
    const hMessages = affectedMessageRows.filter((m) =>
      hConvIds.has(m.conversationUid)
    );
    const hSwipes = affectedSwipeRows.filter((s) => s.hackathonSlug === h.slug);
    const hParts = affectedParticipationRows.filter(
      (p) => p.hackathonSlug === h.slug
    );
    return {
      slug: h.slug,
      name: h.name,
      createdByUid: h.createdByUid,
      verifiedCanonicalUrl: h.verifiedCanonicalUrl,
      teamCount: hTeams.length,
      membershipCount: hMemberships.length,
      conversationCount: hConvs.length,
      messageCount: hMessages.length,
      swipeCount: hSwipes.length,
      participationCount: hParts.length,
    };
  });

  if (execute) {
    if (affectedMessageRows.length > 0) {
      await db.delete(messages).where(
        inArray(
          messages.messageUid,
          affectedMessageRows.map((m) => m.messageUid)
        )
      );
    }
    if (affectedConversationRows.length > 0) {
      await db.delete(conversations).where(
        inArray(
          conversations.conversationUid,
          affectedConversationRows.map((c) => c.conversationUid)
        )
      );
    }
    if (affectedProposalVoteRows.length > 0) {
      await db.delete(teamProposalVotes).where(
        inArray(
          teamProposalVotes.voteKey,
          affectedProposalVoteRows.map((v) => v.voteKey)
        )
      );
    }
    if (affectedProposalRows.length > 0) {
      await db.delete(teamProposals).where(
        inArray(
          teamProposals.proposalUid,
          affectedProposalRows.map((p) => p.proposalUid)
        )
      );
    }
    if (affectedRegistrationRows.length > 0) {
      await db.delete(teamRegistrations).where(
        inArray(
          teamRegistrations.teamSlug,
          affectedRegistrationRows.map((r) => r.teamSlug)
        )
      );
    }
    if (affectedJoinRequestRows.length > 0) {
      await db.delete(joinRequests).where(
        inArray(
          joinRequests.requestUid,
          affectedJoinRequestRows.map((r) => r.requestUid)
        )
      );
    }
    if (affectedSwipeRows.length > 0) {
      await db.delete(swipes).where(
        inArray(
          swipes.swipeKey,
          affectedSwipeRows.map((s) => s.swipeKey)
        )
      );
    }
    if (affectedParticipationRows.length > 0) {
      await db.delete(participations).where(
        inArray(
          participations.participationKey,
          affectedParticipationRows.map((p) => p.participationKey)
        )
      );
    }
    if (affectedMembershipRows.length > 0) {
      await db.delete(memberships).where(
        inArray(
          memberships.membershipKey,
          affectedMembershipRows.map((m) => m.membershipKey)
        )
      );
    }
    if (affectedTeamRows.length > 0) {
      await db.delete(teams).where(
        inArray(
          teams.teamSlug,
          affectedTeamRows.map((t) => t.teamSlug)
        )
      );
    }
    if (testCandidateUidSet.size > 0) {
      await db
        .delete(eventCandidates)
        .where(
          inArray(
            eventCandidates.candidateUid,
            Array.from(testCandidateUidSet)
          )
        );
    }
    if (affectedHackathonRows.length > 0) {
      await db.delete(hackathons).where(
        inArray(
          hackathons.slug,
          affectedHackathonRows.map((h) => h.slug)
        )
      );
    }
    if (testUserUidSet.size > 0) {
      const uids = Array.from(testUserUidSet);
      await db.delete(oauthSessions).where(inArray(oauthSessions.uid, uids));
      await db
        .delete(userBlocks)
        .where(
          or(
            inArray(userBlocks.blockerUid, uids),
            inArray(userBlocks.blockedUid, uids)
          )
        );
      await db.delete(profiles).where(inArray(profiles.uid, uids));
      await db.delete(users).where(inArray(users.uid, uids));
    }
    // Also clean up any expired test OAuth transactions
    await db
      .delete(oauthTransactions)
      .where(like(oauthTransactions.issuer, '%oauth.pesu.mock%'));
  }

  return {
    mode: execute ? 'executed' : 'dry_run',
    timestamp: new Date().toISOString(),
    affectedHackathons: affectedHackathonsSummary,
    affectedCandidateIds: affectedCandidateRows.map((c) => ({
      candidateUid: c.candidateUid,
      title: c.title,
      submittedByUid: c.submittedByUid,
      verifiedCanonicalUrl: c.verifiedCanonicalUrl,
    })),
    affectedTestUserUids: Array.from(testUserUidSet),
    counts: {
      hackathons: affectedHackathonRows.length,
      eventCandidates: affectedCandidateRows.length,
      users: allUsers.filter((u) => testUserUidSet.has(u.uid)).length,
      profiles: affectedProfileRows.length,
      oauthSessions: affectedSessionRows.length,
      teams: affectedTeamRows.length,
      memberships: affectedMembershipRows.length,
      teamProposals: affectedProposalRows.length,
      teamProposalVotes: affectedProposalVoteRows.length,
      teamRegistrations: affectedRegistrationRows.length,
      joinRequests: affectedJoinRequestRows.length,
      conversations: affectedConversationRows.length,
      messages: affectedMessageRows.length,
      swipes: affectedSwipeRows.length,
      participations: affectedParticipationRows.length,
    },
  };
}

/**
 * Startup & test guard that refuses to run integration tests without explicit
 * test mode isolation and ensures test teardown always runs.
 */
export function assertIntegrationTestGuard(): void {
  if (process.env.QUACKATHON_TEST_MODE !== 'true') {
    throw new Error(
      'CRITICAL GUARD: Integration tests cannot run unless QUACKATHON_TEST_MODE=true is explicitly set. Refusing to touch the database.'
    );
  }
  const dbName = process.env.SQL_DB_NAME || '';
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.QUACKATHON_ALLOW_TEST_ON_SHARED_DB !== 'true'
  ) {
    throw new Error(
      `CRITICAL GUARD: Refusing to run integration tests in NODE_ENV=production against database "${dbName}".`
    );
  }
}
