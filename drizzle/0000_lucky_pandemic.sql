CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_uid" text NOT NULL,
	"hackathon_slug" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"participant_uids_json" text DEFAULT '[]' NOT NULL,
	"team_slug" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_conversation_uid_unique" UNIQUE("conversation_uid")
);
--> statement-breakpoint
CREATE TABLE "event_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidate_uid" text NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"original_submission_url" text,
	"verified_canonical_url" text,
	"source_url_status" text DEFAULT 'unverified' NOT NULL,
	"uploaded_attachment_json" text,
	"submitted_by_uid" text,
	"external_fingerprint" text NOT NULL,
	"duplicate_of_hackathon_slug" text,
	"updates_existing_hackathon_slug" text,
	"title" text NOT NULL,
	"organizer" text NOT NULL,
	"event_type" text NOT NULL,
	"matchable" boolean DEFAULT false NOT NULL,
	"themes_json" text DEFAULT '[]' NOT NULL,
	"description" text NOT NULL,
	"start_at" text,
	"end_at" text,
	"registration_deadline" text,
	"campus" text,
	"venue_name" text,
	"format" text DEFAULT 'unknown' NOT NULL,
	"min_team_size" integer,
	"max_team_size" integer,
	"registration_url" text,
	"eligibility_notes" text,
	"field_evidence_json" text DEFAULT '{}' NOT NULL,
	"rule_gate_passed" boolean DEFAULT false NOT NULL,
	"classification_reason" text DEFAULT '' NOT NULL,
	"review_status" text DEFAULT 'needs_confirmation' NOT NULL,
	"warnings_json" text DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "event_candidates_candidate_uid_unique" UNIQUE("candidate_uid")
);
--> statement-breakpoint
CREATE TABLE "hackathons" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"organizer" text NOT NULL,
	"description" text NOT NULL,
	"event_type" text NOT NULL,
	"matchable" boolean DEFAULT true NOT NULL,
	"themes_json" text DEFAULT '[]' NOT NULL,
	"campus" text,
	"venue_name" text,
	"format" text DEFAULT 'unknown' NOT NULL,
	"start_at" text,
	"end_at" text,
	"registration_deadline" text,
	"original_submission_url" text,
	"verified_canonical_url" text,
	"registration_url" text,
	"source_url_status" text DEFAULT 'unverified' NOT NULL,
	"min_team_size" integer,
	"max_team_size" integer,
	"eligibility_notes" text,
	"field_provenance_json" text DEFAULT '{}' NOT NULL,
	"rule_gate_passed" boolean DEFAULT true NOT NULL,
	"classification_reason" text DEFAULT '' NOT NULL,
	"verification_status" text DEFAULT 'verified' NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"created_by_uid" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hackathons_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "join_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"request_uid" text NOT NULL,
	"hackathon_slug" text NOT NULL,
	"team_slug" text NOT NULL,
	"applicant_uid" text NOT NULL,
	"initiator_uid" text NOT NULL,
	"proposed_role" text NOT NULL,
	"message" text,
	"direction" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolution_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	CONSTRAINT "join_requests_request_uid_unique" UNIQUE("request_uid")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"membership_key" text NOT NULL,
	"hackathon_slug" text NOT NULL,
	"team_slug" text NOT NULL,
	"uid" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_membership_key_unique" UNIQUE("membership_key")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_uid" text NOT NULL,
	"conversation_uid" text NOT NULL,
	"sender_uid" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "messages_message_uid_unique" UNIQUE("message_uid")
);
--> statement-breakpoint
CREATE TABLE "oauth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_token" text NOT NULL,
	"uid" text NOT NULL,
	"pesu_sub" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"scopes_json" text DEFAULT '[]' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "participations" (
	"id" serial PRIMARY KEY NOT NULL,
	"participation_key" text NOT NULL,
	"hackathon_slug" text NOT NULL,
	"uid" text NOT NULL,
	"intent" text DEFAULT 'looking' NOT NULL,
	"desired_roles_json" text DEFAULT '[]' NOT NULL,
	"skills_offered_json" text DEFAULT '[]' NOT NULL,
	"availability_windows_json" text DEFAULT '[]' NOT NULL,
	"commitment_level" text DEFAULT 'standard' NOT NULL,
	"work_preferences_json" text DEFAULT '[]' NOT NULL,
	"discoverable" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "participations_participation_key_unique" UNIQUE("participation_key")
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"headline" text NOT NULL,
	"about" text DEFAULT '' NOT NULL,
	"skill_tags_json" text DEFAULT '[]' NOT NULL,
	"interest_tags_json" text DEFAULT '[]' NOT NULL,
	"preferred_roles_json" text DEFAULT '[]' NOT NULL,
	"roles_want_to_learn_json" text DEFAULT '[]' NOT NULL,
	"working_style_tags_json" text DEFAULT '[]' NOT NULL,
	"featured_projects_json" text DEFAULT '[]' NOT NULL,
	"github_username" text,
	"icebreaker_prompt" text,
	"is_first_time_hacker" boolean DEFAULT false NOT NULL,
	"visibility" text DEFAULT 'public_verified_students' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
CREATE TABLE "swipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"swipe_key" text NOT NULL,
	"hackathon_slug" text NOT NULL,
	"from_uid" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"decision" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "swipes_swipe_key_unique" UNIQUE("swipe_key")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" serial PRIMARY KEY NOT NULL,
	"team_slug" text NOT NULL,
	"hackathon_slug" text NOT NULL,
	"leader_uid" text NOT NULL,
	"name" text NOT NULL,
	"pitch" text NOT NULL,
	"project_idea" text,
	"roles_needed_json" text DEFAULT '[]' NOT NULL,
	"custom_specializations_json" text DEFAULT '[]' NOT NULL,
	"desired_domains_json" text DEFAULT '[]' NOT NULL,
	"availability_summary" text DEFAULT 'Flexible' NOT NULL,
	"work_style_tags_json" text DEFAULT '[]' NOT NULL,
	"target_size" integer DEFAULT 4 NOT NULL,
	"member_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "teams_team_slug_unique" UNIQUE("team_slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"uid" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"campus" text DEFAULT 'RR Campus' NOT NULL,
	"program" text DEFAULT 'B.Tech CSE',
	"graduation_year" integer DEFAULT 2027,
	"verification_status" text DEFAULT 'verified_pesu_oidc' NOT NULL,
	"pesu_oidc_sub" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"privacy_preferences_json" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_uid_unique" UNIQUE("uid")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_uid_users_uid_fk" FOREIGN KEY ("uid") REFERENCES "public"."users"("uid") ON DELETE no action ON UPDATE no action;