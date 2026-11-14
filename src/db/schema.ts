import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull(),
  campus: text('campus').notNull().default('RR Campus'),
  program: text('program').default('B.Tech CSE'),
  graduationYear: integer('graduation_year').default(2027),
  verificationStatus: text('verification_status')
    .notNull()
    .default('verified_pesu_oidc'),
  pesuOidcSub: text('pesu_oidc_sub').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  privacyPreferencesJson: text('privacy_preferences_json').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const profiles = pgTable('profiles', {
  id: serial('id').primaryKey(),
  uid: text('uid')
    .notNull()
    .unique()
    .references(() => users.uid),
  headline: text('headline').notNull(),
  about: text('about').notNull().default(''),
  skillTagsJson: text('skill_tags_json').notNull().default('[]'),
  interestTagsJson: text('interest_tags_json').notNull().default('[]'),
  projectDomainsJson: text('project_domains_json').notNull().default('[]'),
  topicsToExploreJson: text('topics_to_explore_json').notNull().default('[]'),
  hackathonGoalsJson: text('hackathon_goals_json').notNull().default('[]'),
  portfolioLinksJson: text('portfolio_links_json').notNull().default('[]'),
  preferredRolesJson: text('preferred_roles_json').notNull().default('[]'),
  rolesWantToLearnJson: text('roles_want_to_learn_json').notNull().default('[]'),
  workingStyleTagsJson: text('working_style_tags_json').notNull().default('[]'),
  featuredProjectsJson: text('featured_projects_json').notNull().default('[]'),
  githubUsername: text('github_username'),
  icebreakerPrompt: text('icebreaker_prompt'),
  isFirstTimeHacker: boolean('is_first_time_hacker').notNull().default(false),
  visibility: text('visibility')
    .notNull()
    .default('public_verified_students'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const hackathons = pgTable('hackathons', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  organizer: text('organizer').notNull(),
  description: text('description').notNull(),
  eventType: text('event_type').notNull(),
  matchable: boolean('matchable').notNull().default(true),
  themesJson: text('themes_json').notNull().default('[]'),
  campus: text('campus'),
  venueName: text('venue_name'),
  format: text('format').notNull().default('unknown'),
  startAt: text('start_at'),
  endAt: text('end_at'),
  registrationDeadline: text('registration_deadline'),
  originalSubmissionUrl: text('original_submission_url'),
  verifiedCanonicalUrl: text('verified_canonical_url'),
  registrationUrl: text('registration_url'),
  sourceUrlStatus: text('source_url_status').notNull().default('unverified'),
  minTeamSize: integer('min_team_size'),
  maxTeamSize: integer('max_team_size'),
  eligibilityNotes: text('eligibility_notes'),
  fieldProvenanceJson: text('field_provenance_json').notNull().default('{}'),
  ruleGatePassed: boolean('rule_gate_passed').notNull().default(true),
  classificationReason: text('classification_reason').notNull().default(''),
  verificationStatus: text('verification_status')
    .notNull()
    .default('verified'),
  status: text('status').notNull().default('published'),
  createdByUid: text('created_by_uid').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const eventCandidates = pgTable('event_candidates', {
  id: serial('id').primaryKey(),
  candidateUid: text('candidate_uid').notNull().unique(),
  source: text('source').notNull(),
  sourceUrl: text('source_url'),
  originalSubmissionUrl: text('original_submission_url'),
  verifiedCanonicalUrl: text('verified_canonical_url'),
  sourceUrlStatus: text('source_url_status').notNull().default('unverified'),
  uploadedAttachmentJson: text('uploaded_attachment_json'),
  submittedByUid: text('submitted_by_uid'),
  externalFingerprint: text('external_fingerprint').notNull(),
  duplicateOfHackathonSlug: text('duplicate_of_hackathon_slug'),
  updatesExistingHackathonSlug: text('updates_existing_hackathon_slug'),
  title: text('title').notNull(),
  organizer: text('organizer').notNull(),
  eventType: text('event_type').notNull(),
  matchable: boolean('matchable').notNull().default(false),
  themesJson: text('themes_json').notNull().default('[]'),
  description: text('description').notNull(),
  startAt: text('start_at'),
  endAt: text('end_at'),
  registrationDeadline: text('registration_deadline'),
  campus: text('campus'),
  venueName: text('venue_name'),
  format: text('format').notNull().default('unknown'),
  minTeamSize: integer('min_team_size'),
  maxTeamSize: integer('max_team_size'),
  registrationUrl: text('registration_url'),
  eligibilityNotes: text('eligibility_notes'),
  fieldEvidenceJson: text('field_evidence_json').notNull().default('{}'),
  ruleGatePassed: boolean('rule_gate_passed').notNull().default(false),
  classificationReason: text('classification_reason').notNull().default(''),
  reviewStatus: text('review_status').notNull().default('needs_confirmation'),
  warningsJson: text('warnings_json').notNull().default('[]'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const participations = pgTable('participations', {
  id: serial('id').primaryKey(),
  participationKey: text('participation_key').notNull().unique(),
  hackathonSlug: text('hackathon_slug').notNull(),
  uid: text('uid').notNull(),
  intent: text('intent').notNull().default('looking'),
  desiredRolesJson: text('desired_roles_json').notNull().default('[]'),
  skillsOfferedJson: text('skills_offered_json').notNull().default('[]'),
  availabilityWindowsJson: text('availability_windows_json')
    .notNull()
    .default('[]'),
  commitmentLevel: text('commitment_level').notNull().default('standard'),
  workPreferencesJson: text('work_preferences_json').notNull().default('[]'),
  discoverable: boolean('discoverable').notNull().default(true),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const teams = pgTable('teams', {
  id: serial('id').primaryKey(),
  teamSlug: text('team_slug').notNull().unique(),
  hackathonSlug: text('hackathon_slug').notNull(),
  leaderUid: text('leader_uid').notNull(),
  name: text('name').notNull(),
  pitch: text('pitch').notNull(),
  projectIdea: text('project_idea'),
  rolesNeededJson: text('roles_needed_json').notNull().default('[]'),
  customSpecializationsJson: text('custom_specializations_json')
    .notNull()
    .default('[]'),
  desiredDomainsJson: text('desired_domains_json').notNull().default('[]'),
  availabilitySummary: text('availability_summary').notNull().default('Flexible'),
  workStyleTagsJson: text('work_style_tags_json').notNull().default('[]'),
  targetSize: integer('target_size').notNull().default(4),
  memberCount: integer('member_count').notNull().default(1),
  status: text('status').notNull().default('open'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const memberships = pgTable('memberships', {
  id: serial('id').primaryKey(),
  membershipKey: text('membership_key').notNull().unique(), // `${hackathonSlug}_${uid}` enforces 1 team per user per hackathon
  hackathonSlug: text('hackathon_slug').notNull(),
  teamSlug: text('team_slug').notNull(),
  uid: text('uid').notNull(),
  role: text('role').notNull(),
  status: text('status').notNull().default('active'),
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
});

export const swipes = pgTable('swipes', {
  id: serial('id').primaryKey(),
  swipeKey: text('swipe_key').notNull().unique(), // `${hackathonSlug}_${fromUid}_${targetType}_${targetId}`
  hackathonSlug: text('hackathon_slug').notNull(),
  fromUid: text('from_uid').notNull(),
  targetType: text('target_type').notNull(), // 'user' | 'team'
  targetId: text('target_id').notNull(),
  decision: text('decision').notNull(), // 'interested' | 'passed'
  note: text('note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const joinRequests = pgTable('join_requests', {
  id: serial('id').primaryKey(),
  requestUid: text('request_uid').notNull().unique(),
  hackathonSlug: text('hackathon_slug').notNull(),
  teamSlug: text('team_slug').notNull(),
  applicantUid: text('applicant_uid').notNull(),
  initiatorUid: text('initiator_uid').notNull(),
  proposedRole: text('proposed_role').notNull(),
  message: text('message'),
  direction: text('direction').notNull(), // 'application' | 'invitation'
  status: text('status').notNull().default('pending'), // 'pending' | 'accepted' | 'rejected' | 'expired'
  resolutionNote: text('resolution_note'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
});

export const conversations = pgTable('conversations', {
  id: serial('id').primaryKey(),
  conversationUid: text('conversation_uid').notNull().unique(),
  hackathonSlug: text('hackathon_slug').notNull(),
  type: text('type').notNull(), // 'direct_match' | 'team_roster'
  title: text('title').notNull(),
  participantUidsJson: text('participant_uids_json').notNull().default('[]'),
  teamSlug: text('team_slug'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  lastMessageAt: timestamp('last_message_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  messageUid: text('message_uid').notNull().unique(),
  conversationUid: text('conversation_uid').notNull(),
  senderUid: text('sender_uid').notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const oauthSessions = pgTable('oauth_sessions', {
  id: serial('id').primaryKey(),
  sessionToken: text('session_token').notNull().unique(),
  uid: text('uid').notNull(),
  pesuSub: text('pesu_sub').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  scopesJson: text('scopes_json').notNull().default('[]'),
  expiresAt: timestamp('expires_at').notNull(),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ one }) => ({
  profile: one(profiles, {
    fields: [users.uid],
    references: [profiles.uid],
  }),
}));

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, {
    fields: [profiles.uid],
    references: [users.uid],
  }),
}));
