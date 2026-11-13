/**
 * PES Hackathon Team Finder (Assemble) — v0.3 Domain Model & Type Contracts
 * Mirrors Section 6, Section 7, Section 8, Section 9, and Section 10 of Architecture v0.3.
 */

export type CampusType = 'RR Campus' | 'EC Campus' | 'Online / Multi-Campus';
export type DiscoveryMode = 'people' | 'teams';
export type ParticipationIntent = 'looking' | 'recruiting' | 'open';
export type CommitmentLevel = 'light' | 'standard' | 'intensive';
export type EventType =
  | 'hackathon'
  | 'ideathon'
  | 'buildathon'
  | 'ctf'
  | 'team_competition'
  | 'workshop'
  | 'tech_talk'
  | 'other'
  | 'unknown';

export type EventLifecycleStatus =
  | 'draft'
  | 'published'
  | 'registration_closed'
  | 'in_progress'
  | 'completed'
  | 'archived';

export type ReviewQueueStatus =
  | 'new'
  | 'needs_confirmation'
  | 'approved'
  | 'rejected'
  | 'superseded';

export type EventSourceType =
  | 'pes_public_events'
  | 'approved_organizer'
  | 'academy_opt_in_hint'
  | 'submitted_public_url';

export type RequestDirection = 'application' | 'invitation';
export type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';

export interface User {
  uid: string;
  displayName: string;
  campus: CampusType;
  program?: string;
  graduationYear?: number;
  verificationStatus: 'verified_pesu_oidc' | 'pilot_invite' | 'unverified';
  pesuOidcSub: string;
  isAdmin?: boolean;
  personaLabel: string;
  createdAt: string;
  accountStatus: 'active' | 'suspended';
  privacyPreferences: {
    profileVisible: boolean;
    githubConsent: boolean;
    aiEnrichmentConsent: boolean;
    academyAnnouncementsOptIn: boolean;
    academyTimetableOptIn: boolean;
  };
}

export interface FeaturedProject {
  id: string;
  title: string;
  description: string;
  sourceUrl?: string;
  tags: string[];
  isCourseworkOrIdea?: boolean;
}

export interface Profile {
  uid: string;
  headline: string;
  about: string;
  skillTags: string[];
  interestTags: string[];
  projectDomains: string[];
  topicsToExplore: string[];
  preferredRoles: string[];
  rolesWantToLearn: string[];
  workingStyleTags: string[];
  hackathonGoals: string[];
  icebreakerPrompt?: string;
  portfolioLinks: { label: string; url: string }[];
  featuredProjects: FeaturedProject[];
  githubUsername?: string;
  isFirstTimeHacker?: boolean;
  visibility: 'public_verified_students' | 'hidden';
  updatedAt: string;
}

export interface ProfileEvidenceDraft {
  id: string;
  uid: string;
  source: 'github' | 'manual';
  sourceUrl: string;
  repoName: string;
  rawEvidenceSummary: string;
  suggestedSkills: {
    name: string;
    category: string;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    approved: boolean;
  }[];
  suggestedProject: {
    title: string;
    description: string;
    sourceUrl: string;
    tags: string[];
    approved: boolean;
  };
  sanitizedWarnings: string[];
  fetchedAt: string;
  userReviewed: boolean;
}

export interface FieldProvenanceEntry {
  sourceUrl: string;
  sourceType: EventSourceType;
  excerpt: string;
  verifiedAt?: string;
}

export interface Hackathon {
  id: string;
  name: string;
  description: string;
  eventType: EventType;
  matchable: boolean; // False for workshops, tech talks, solo-only CTFs, or unverified constraints
  themes: string[];
  venue: {
    name: string | null;
    campus: CampusType | null;
    building?: string | null;
    room?: string | null;
  };
  format: 'onsite' | 'online' | 'hybrid' | 'unknown';
  startAt: string | null; // ISO or date-only string; never invent missing midnight
  datePrecision: 'exact_instant' | 'date_only' | 'unknown';
  endAt: string | null;
  timezone: string;
  registrationDeadline: string | null;
  registrationUrl: string | null;
  minTeamSize: number | null; // Null when unconfirmed — never guess numeric bounds
  maxTeamSize: number | null;
  eligibilityNotes: string | null;
  organizer: string;
  sourceIds: string[];
  fieldProvenance: Record<string, FieldProvenanceEntry>;
  suggestedByCount: number;
  classification: {
    category: EventType;
    ruleGatePassed: boolean;
    mlConfidenceScore: number;
    reason: string;
  };
  lastVerifiedAt: string | null;
  verificationStatus: 'verified' | 'unconfirmed_constraints';
  status: EventLifecycleStatus;
  createdBy: string;
}

export interface EventCandidate {
  id: string;
  source: EventSourceType;
  sourceUrl?: string;
  submittedByUid?: string;
  externalFingerprint: string; // normalized organizer + title + start date
  duplicateOfHackathonId?: string;
  updatesExistingHackathonId?: string;
  proposedDiffs?: {
    field: string;
    previousVerifiedValue: string;
    newProposedValue: string;
    evidenceExcerpt: string;
  }[];
  title: string;
  organizer: string;
  eventType: EventType;
  matchable: boolean;
  themes: string[];
  description: string;
  startAt: string | null;
  endAt: string | null;
  registrationDeadline: string | null;
  timezone: string;
  venue: {
    campus?: CampusType | null;
    name?: string | null;
  };
  format: 'onsite' | 'online' | 'hybrid' | 'unknown';
  teamSize: {
    min: number | null;
    max: number | null;
  };
  registrationUrl: string | null;
  eligibilityNotes: string | null;
  fieldEvidence: Record<string, { sourceUrl: string; excerpt?: string }[]>;
  classification: {
    ruleGatePassed: boolean;
    mlScore: number;
    reason: string;
  };
  reviewStatus: ReviewQueueStatus;
  warnings: string[];
  lastSeenAt: string;
}

export interface PrivateAcademyHint {
  id: string;
  ownerUid: string;
  scopeUsed: 'announcements:read' | 'timetable:read';
  noticeTitle: string;
  detectedDateHint: string;
  isTeamCompetitionCandidate: boolean;
  publicLinkFound?: string;
  note: string;
}

export interface Participation {
  id: string; // deterministic: `${hackathonId}_${uid}`
  hackathonId: string;
  uid: string;
  intent: ParticipationIntent;
  desiredRoles: string[];
  skillsOffered: string[];
  availabilityWindows: string[];
  commitmentLevel: CommitmentLevel;
  workPreferences: string[];
  teamId?: string;
  discoverable: boolean;
  updatedAt: string;
}

export interface Team {
  id: string;
  hackathonId: string;
  leaderId: string;
  name: string;
  pitch: string;
  projectIdea?: string;
  rolesNeeded: string[];
  desiredDomains: string[];
  availabilitySummary: string;
  workStyleTags: string[];
  targetSize: number; // Bounded by hackathon minTeamSize..maxTeamSize
  memberCount: number;
  status: 'open' | 'full' | 'locked';
  visibility: 'public' | 'unlisted';
  createdAt: string;
}

export interface Membership {
  id: string; // deterministic: `${hackathonId}_${uid}`
  hackathonId: string;
  teamId: string;
  uid: string;
  role: string;
  joinedAt: string;
  status: 'active' | 'left';
}

export interface Interest {
  id: string; // deterministic: `${hackathonId}_${fromUid}_${targetType}_${targetId}`
  hackathonId: string;
  fromUid: string;
  targetType: 'user' | 'team';
  targetId: string;
  decision: 'interested' | 'passed';
  createdAt: string;
}

export interface JoinRequest {
  id: string;
  hackathonId: string;
  teamId: string;
  applicantUid: string;
  initiatorUid: string;
  proposedRole: string;
  message?: string;
  direction: RequestDirection;
  status: RequestStatus;
  resolutionNote?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderUid: string;
  body: string;
  createdAt: string;
  moderationStatus: 'clean' | 'flagged';
}

export interface Conversation {
  id: string;
  hackathonId: string;
  type: 'direct_match' | 'team_roster';
  title: string;
  participantUids: string[];
  teamId?: string;
  createdAt: string;
  lastMessageAt: string;
}

export interface CandidateCard {
  id: string;
  type: 'person' | 'team';
  hackathonId: string;
  title: string;
  subtitle: string;
  campus?: string;
  isFirstTimeHacker?: boolean;
  skills: string[];
  rolesOfferedOrNeeded: string[];
  rolesWantToLearn?: string[];
  featuredEvidence: { title: string; description: string; url?: string; isCoursework?: boolean }[];
  compatibilityReasons: string[];
  remainingSlots?: number;
  targetSize?: number;
  memberCount?: number;
  leaderUid?: string;
  availabilitySummary: string;
  commitmentLevel?: CommitmentLevel;
  workingStyle: string[];
  sharedInterests: string[];
  complementaryRoles: string[];
  icebreakerDrafts: string[];
  // Internal feature breakdown for the transparent ranking inspector (never shown as a public score of a person)
  featureBreakdown: {
    mode: 'peer' | 'team_candidate';
    primaryFitLabel: string;
    interestOrRoleSim: number;
    tfidfThemeSim: number;
    availabilitySim: number;
    collabOrSkillSim: number;
    coldStartRedistributed: boolean;
  };
}

export interface InterestCircle {
  id: string;
  label: string;
  description: string;
  matchingTags: string[];
  participantCount: number;
}

export interface ReportRecord {
  id: string;
  reporterUid: string;
  targetType: 'user' | 'team' | 'message';
  targetId: string;
  targetLabel: string;
  reason: string;
  status: 'open' | 'resolved_dismissed' | 'resolved_actioned';
  createdAt: string;
}

export interface BlockRecord {
  id: string; // `${blockerUid}_${blockedUid}`
  blockerUid: string;
  blockedUid: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  action: string;
  targetId: string;
  summary: string;
  createdAt: string;
}
