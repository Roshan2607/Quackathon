/**
 * Quackathon (PES Hackathon Team Finder) — Domain Model & Type Contracts
 * Preserves full compatibility with existing profiles, teams, and hackathons while adding:
 * - Distinct originalSubmissionUrl, verifiedCanonicalUrl, registrationUrl, and sourceUrlStatus
 * - Custom complementary specializations (customSpecializations[]) on Teams and CandidateCards
 * - Uploaded brochure/poster metadata on EventCandidates
 * - Demo Mode vs. Live API Test Mode types
 */

export type ExecutionMode = 'demo' | 'live';
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
  | 'conference'
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
  | 'paasha_microservice'
  | 'approved_organizer'
  | 'academy_opt_in_hint'
  | 'submitted_public_url'
  | 'uploaded_brochure_or_poster';

export type RegistrationHighLevelStatus = 'OPEN' | 'CLOSED' | 'UNKNOWN';

export type RegistrationDetailStatus =
  | 'open_confirmed'
  | 'deadline_known'
  | 'link_available'
  | 'unknown'
  | 'closed'
  | 'ended';

export type SourceUrlVerificationStatus =
  | 'verified'
  | 'redirected_valid'
  | 'unverified'
  | 'unavailable'
  | 'blocked_policy'
  | 'broken';

export type RequestDirection = 'application' | 'invitation';
export type RequestStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'expired';

export interface User {
  uid: string;
  displayName: string;
  campus: CampusType;
  program?: string;
  graduationYear?: number;
  verified?: boolean;
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
  bio?: string;
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
  isLiveApiResult?: boolean;
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
  suggestedProjects?: {
    title: string;
    description: string;
    sourceUrl: string;
    tags: string[];
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
  shortDescription?: string;
  description: string;
  eventType: EventType;
  categoryLabel?: string;
  isHackathon?: boolean;
  teamParticipationVerified?: boolean;
  publicSourceVerified?: boolean;
  matchable: boolean;
  findTeammatesEligible?: boolean;
  themes: string[];
  venue: {
    name: string | null;
    campus: CampusType | null;
    building?: string | null;
    room?: string | null;
  };
  format: 'onsite' | 'online' | 'hybrid' | 'unknown';
  startAt: string | null;
  datePrecision: 'exact_instant' | 'date_only' | 'unknown';
  endAt: string | null;
  dateDisplay?: string;
  timezone: string;
  registrationDeadline: string | null;
  registrationStatus?: RegistrationHighLevelStatus;
  registrationStatusDetail?: RegistrationDetailStatus;
  registrationStatusLabel?: string;
  // Distinct URL tracking (Requirement #4)
  originalSubmissionUrl?: string | null;
  verifiedCanonicalUrl?: string | null;
  registrationUrl: string | null;
  sourceUrlStatus?: SourceUrlVerificationStatus;
  minTeamSize: number | null;
  maxTeamSize: number | null;
  teamSize?: {
    min: number | null;
    max: number | null;
  };
  eligibilityNotes: string | null;
  organizer: string;
  sourceType?: EventSourceType;
  sources?: (EventSourceType | string)[];
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
  extractedAt?: string | null;
  verificationStatus: 'verified' | 'unconfirmed_constraints';
  status: EventLifecycleStatus;
  createdBy: string;
}

export interface EventCandidate {
  id: string;
  source: EventSourceType;
  sourceUrl?: string;
  originalSubmissionUrl?: string | null;
  verifiedCanonicalUrl?: string | null;
  sourceUrlStatus?: SourceUrlVerificationStatus;
  uploadedAttachment?: {
    fileName: string;
    mimeType: string;
    byteSize: number;
    extractedEvidenceQuote?: string;
  };
  submittedByUid?: string;
  externalFingerprint: string;
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
  id: string;
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
  // Custom free-text specializations (Requirement #5)
  customSpecializations?: string[];
  desiredDomains: string[];
  availabilitySummary: string;
  workStyleTags: string[];
  targetSize: number;
  memberCount: number;
  status: 'open' | 'full' | 'locked' | 'dissolved';
  visibility: 'public' | 'unlisted';
  createdAt: string;
}

export interface Membership {
  id: string;
  hackathonId: string;
  teamId: string;
  uid: string;
  role: string;
  joinedAt: string;
  status: 'active' | 'left';
}

export interface Interest {
  id: string;
  hackathonId: string;
  fromUid: string;
  targetType: 'user' | 'team';
  targetId: string;
  decision: 'interested' | 'passed';
  note?: string;
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
  customSpecializations?: string[];
  matchedSpecializations?: string[];
  rolesWantToLearn?: string[];
  featuredEvidence: {
    title: string;
    description: string;
    url?: string;
    isCoursework?: boolean;
    tech?: string[];
  }[];
  compatibilityReasons: string[];
  overallScore?: number;
  reasons?: string[];
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
  featureBreakdown: {
    mode: 'peer' | 'team_candidate';
    primaryFitLabel: string;
    interestOrRoleSim: number;
    tfidfThemeSim: number;
    availabilitySim: number;
    collabOrSkillSim: number;
    coldStartRedistributed: boolean;
    skillComplementarity?: number;
    skillComplementarityScore?: number;
    sharedInterestsScore?: number;
    pastSwipeAffinityScore?: number;
    totalScore?: number;
    evaluatedAgainstTeamId?: string;
    evaluatedAgainstMemberCount?: number;
    complementarySkills?: string[];
  };
}

export type TeamProposalStatus =
  | 'pending_votes'
  | 'invited'
  | 'accepted'
  | 'rejected'
  | 'declined'
  | 'expired';

export interface TeamProposalVote {
  id: string;
  proposalId: string;
  teamId: string;
  voterUid: string;
  voterName?: string;
  decision: 'approve' | 'reject';
  comment?: string;
  votedAt: string;
}

export interface TeamProposal {
  id: string;
  hackathonId: string;
  teamId: string;
  teamName?: string;
  candidateUid: string;
  candidateName?: string;
  candidateHeadline?: string;
  candidateSkills?: string[];
  proposedByUid: string;
  proposerUid?: string;
  proposedByName?: string;
  proposedRole: string;
  message?: string;
  note?: string;
  status: TeamProposalStatus;
  resolutionNote?: string;
  votes: TeamProposalVote[];
  requiredVoterUids: string[];
  approvedCount: number;
  requiredCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export type TeamRegistrationStatus =
  | 'forming'
  | 'ready_to_register'
  | 'registration_in_progress'
  | 'registered'
  | 'registration_closed';

export interface TeamRegistration {
  teamId: string;
  hackathonId: string;
  registrationStatus: TeamRegistrationStatus;
  officialRegistrationUrl: string | null;
  registrationUrlSnapshot?: string | null;
  externalRegistrationReference?: string | null;
  confirmationNotes?: string | null;
  registeredByUid?: string | null;
  registeredAt?: string | null;
  minRequiredMembers: number;
  maxAllowedMembers: number;
  currentMemberCount: number;
  isEligibleToRegister: boolean;
  readinessReason: string;
  minTeamSizeSnapshot?: number;
  maxTeamSizeSnapshot?: number;
  currentMemberCountSnapshot?: number;
  memberCountAtCheck?: number;
  eligibleToRegister?: boolean;
  eligibilityReason?: string;
  updatedAt: string;
}

export interface ShortlistEntry {
  uid: string;
  displayName: string;
  campus: CampusType;
  program?: string;
  graduationYear?: number;
  headline: string;
  skillTags: string[];
  interestTags: string[];
  preferredRoles: string[];
  swipedAt: string;
  status:
    | 'awaiting_response'
    | 'interested_in_you'
    | 'mutual_match'
    | 'in_your_team'
    | 'proposal_pending_votes'
    | 'proposal_invited';
  conversationId?: string;
  teamId?: string;
  proposalId?: string;
}

export interface ShortlistPayload {
  hackathonId: string;
  interested: ShortlistEntry[];
  interestedInYou: ShortlistEntry[];
  mutualMatches: ShortlistEntry[];
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
  id: string;
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

