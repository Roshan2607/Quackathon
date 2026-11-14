-- Data integrity constraints (task: enforce enums in the database).
-- Every value listed here is written by the application today; unknown values
-- are rejected by PostgreSQL instead of being silently accepted.

-- users ------------------------------------------------------------------------
ALTER TABLE "users" ADD CONSTRAINT "users_verification_status_check"
  CHECK ("verification_status" IN ('verified_pesu_oidc', 'pilot_invite', 'unverified'));--> statement-breakpoint

-- profiles ---------------------------------------------------------------------
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_visibility_check"
  CHECK ("visibility" IN ('public_verified_students', 'hidden'));--> statement-breakpoint

-- hackathons -------------------------------------------------------------------
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_event_type_check"
  CHECK ("event_type" IN ('hackathon', 'ideathon', 'buildathon', 'ctf', 'team_competition', 'workshop', 'tech_talk', 'other', 'unknown'));--> statement-breakpoint
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_format_check"
  CHECK ("format" IN ('onsite', 'online', 'hybrid', 'unknown'));--> statement-breakpoint
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_status_check"
  CHECK ("status" IN ('draft', 'published', 'registration_closed', 'in_progress', 'completed', 'archived'));--> statement-breakpoint
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_source_url_status_check"
  CHECK ("source_url_status" IN ('verified', 'redirected_valid', 'unverified', 'unavailable'));--> statement-breakpoint
ALTER TABLE "hackathons" ADD CONSTRAINT "hackathons_verification_status_check"
  CHECK ("verification_status" IN ('verified', 'unconfirmed_constraints'));--> statement-breakpoint

-- event_candidates --------------------------------------------------------------
ALTER TABLE "event_candidates" ADD CONSTRAINT "event_candidates_source_check"
  CHECK ("source" IN ('pes_public_events', 'approved_organizer', 'academy_opt_in_hint', 'submitted_public_url', 'uploaded_brochure_or_poster'));--> statement-breakpoint
ALTER TABLE "event_candidates" ADD CONSTRAINT "event_candidates_event_type_check"
  CHECK ("event_type" IN ('hackathon', 'ideathon', 'buildathon', 'ctf', 'team_competition', 'workshop', 'tech_talk', 'other', 'unknown'));--> statement-breakpoint
ALTER TABLE "event_candidates" ADD CONSTRAINT "event_candidates_format_check"
  CHECK ("format" IN ('onsite', 'online', 'hybrid', 'unknown'));--> statement-breakpoint
ALTER TABLE "event_candidates" ADD CONSTRAINT "event_candidates_source_url_status_check"
  CHECK ("source_url_status" IN ('verified', 'redirected_valid', 'unverified', 'unavailable'));--> statement-breakpoint
ALTER TABLE "event_candidates" ADD CONSTRAINT "event_candidates_review_status_check"
  CHECK ("review_status" IN ('new', 'needs_confirmation', 'approved', 'rejected', 'superseded'));--> statement-breakpoint

-- participations ----------------------------------------------------------------
ALTER TABLE "participations" ADD CONSTRAINT "participations_intent_check"
  CHECK ("intent" IN ('looking', 'recruiting', 'open'));--> statement-breakpoint
ALTER TABLE "participations" ADD CONSTRAINT "participations_commitment_level_check"
  CHECK ("commitment_level" IN ('light', 'standard', 'intensive'));--> statement-breakpoint

-- teams --------------------------------------------------------------------------
ALTER TABLE "teams" ADD CONSTRAINT "teams_status_check"
  CHECK ("status" IN ('open', 'full', 'locked'));--> statement-breakpoint

-- memberships --------------------------------------------------------------------
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_status_check"
  CHECK ("status" IN ('active', 'left'));--> statement-breakpoint

-- swipes -------------------------------------------------------------------------
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_decision_check"
  CHECK ("decision" IN ('interested', 'passed'));--> statement-breakpoint
ALTER TABLE "swipes" ADD CONSTRAINT "swipes_target_type_check"
  CHECK ("target_type" IN ('user', 'team'));--> statement-breakpoint

-- join_requests ------------------------------------------------------------------
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_status_check"
  CHECK ("status" IN ('pending', 'accepted', 'rejected', 'withdrawn', 'expired'));--> statement-breakpoint
ALTER TABLE "join_requests" ADD CONSTRAINT "join_requests_direction_check"
  CHECK ("direction" IN ('application', 'invitation'));--> statement-breakpoint

-- conversations -------------------------------------------------------------------
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_type_check"
  CHECK ("type" IN ('direct_match', 'team_roster'));
