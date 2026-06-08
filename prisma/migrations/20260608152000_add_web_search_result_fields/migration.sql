ALTER TABLE "consultation_results"
ADD COLUMN "source_references" JSONB,
ADD COLUMN "web_search_used" BOOLEAN NOT NULL DEFAULT false;
