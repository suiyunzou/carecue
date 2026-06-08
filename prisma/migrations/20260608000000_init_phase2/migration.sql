-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_login_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "chief_complaint" TEXT NOT NULL,
    "scenario" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_answers" (
    "id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "question_key" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "answer_value" JSONB NOT NULL,
    "answer_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_results" (
    "id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "urgency_level" TEXT NOT NULL,
    "urgency_title" TEXT NOT NULL,
    "urgency_advice" TEXT NOT NULL,
    "possible_directions" JSONB NOT NULL,
    "department_suggestion" TEXT NOT NULL,
    "daily_advice" JSONB NOT NULL,
    "doctor_summary" TEXT NOT NULL,
    "uncertainty_items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consultation_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "consultation_records_user_id_created_at_idx" ON "consultation_records"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "consultation_answers_record_id_idx" ON "consultation_answers"("record_id");

-- CreateIndex
CREATE UNIQUE INDEX "consultation_results_record_id_key" ON "consultation_results"("record_id");

-- AddForeignKey
ALTER TABLE "consultation_records" ADD CONSTRAINT "consultation_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_answers" ADD CONSTRAINT "consultation_answers_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "consultation_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultation_results" ADD CONSTRAINT "consultation_results_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "consultation_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
