ALTER TABLE "consultation_results"
ADD COLUMN "ai_status" TEXT NOT NULL DEFAULT 'disabled',
ADD COLUMN "ai_model" TEXT,
ADD COLUMN "ai_summary" TEXT,
ADD COLUMN "missing_information" JSONB,
ADD COLUMN "next_steps" JSONB,
ADD COLUMN "safety_flags" JSONB;
