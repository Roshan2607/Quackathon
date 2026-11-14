ALTER TABLE "profiles" ADD COLUMN "project_domains_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "topics_to_explore_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "hackathon_goals_json" text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "portfolio_links_json" text DEFAULT '[]' NOT NULL;