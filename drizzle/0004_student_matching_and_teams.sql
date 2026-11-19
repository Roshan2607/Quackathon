-- Additive migration: Unified Student Matching, Automatic Teams, Unanimous Team Proposals, Team Registrations, and User Blocks
CREATE TABLE IF NOT EXISTS "team_proposals" (
  "id" serial PRIMARY KEY NOT NULL,
  "proposal_uid" text NOT NULL UNIQUE,
  "hackathon_slug" text NOT NULL,
  "team_slug" text NOT NULL,
  "candidate_uid" text NOT NULL,
  "proposed_by_uid" text NOT NULL,
  "proposed_role" text DEFAULT 'Core Builder' NOT NULL,
  "message" text,
  "status" text DEFAULT 'pending_votes' NOT NULL,
  "resolution_note" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "idx_team_proposals_team_status" ON "team_proposals" ("team_slug", "status");
CREATE INDEX IF NOT EXISTS "idx_team_proposals_candidate_status" ON "team_proposals" ("candidate_uid", "status");
CREATE INDEX IF NOT EXISTS "idx_team_proposals_hackathon" ON "team_proposals" ("hackathon_slug");

CREATE TABLE IF NOT EXISTS "team_proposal_votes" (
  "id" serial PRIMARY KEY NOT NULL,
  "vote_key" text NOT NULL UNIQUE,
  "proposal_uid" text NOT NULL,
  "team_slug" text NOT NULL,
  "voter_uid" text NOT NULL,
  "decision" text NOT NULL,
  "comment" text,
  "voted_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_team_proposal_votes_proposal" ON "team_proposal_votes" ("proposal_uid");
CREATE INDEX IF NOT EXISTS "idx_team_proposal_votes_team" ON "team_proposal_votes" ("team_slug");

CREATE TABLE IF NOT EXISTS "team_registrations" (
  "id" serial PRIMARY KEY NOT NULL,
  "team_slug" text NOT NULL UNIQUE,
  "hackathon_slug" text NOT NULL,
  "registration_status" text DEFAULT 'forming' NOT NULL,
  "official_registration_url" text,
  "external_registration_reference" text,
  "confirmation_notes" text,
  "registered_by_uid" text,
  "registered_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_team_registrations_hackathon" ON "team_registrations" ("hackathon_slug");
CREATE INDEX IF NOT EXISTS "idx_team_registrations_status" ON "team_registrations" ("registration_status");

CREATE TABLE IF NOT EXISTS "user_blocks" (
  "id" serial PRIMARY KEY NOT NULL,
  "block_key" text NOT NULL UNIQUE,
  "blocker_uid" text NOT NULL,
  "blocked_uid" text NOT NULL,
  "reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_user_blocks_blocker" ON "user_blocks" ("blocker_uid");
CREATE INDEX IF NOT EXISTS "idx_user_blocks_blocked" ON "user_blocks" ("blocked_uid");
