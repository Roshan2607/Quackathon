CREATE TABLE IF NOT EXISTS "oauth_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"state_hash" text NOT NULL,
	"initiating_session_id_hash" text NOT NULL,
	"encrypted_code_verifier" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"client_origin" text,
	"scopes_json" text DEFAULT '[]' NOT NULL,
	"issuer" text NOT NULL,
	"authorization_endpoint" text NOT NULL,
	"token_endpoint" text NOT NULL,
	"userinfo_endpoint" text,
	"consumed" boolean DEFAULT false NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "oauth_transactions_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_sessions" ADD COLUMN IF NOT EXISTS "initiating_session_id_hash" text;
