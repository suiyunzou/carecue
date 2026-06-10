-- CareCue Agent 数据库表 — v3.0 设计文档 §32
-- P0 当前使用内存存储（InMemoryCaseStore），以下为后续持久化的目标表结构。
-- 接入 Prisma 时按本结构补充 model 定义并执行迁移。

CREATE TABLE cases (
  id UUID PRIMARY KEY,
  user_id UUID NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  chief_complaint TEXT,
  primary_domain VARCHAR(64),
  risk_level VARCHAR(8) NOT NULL DEFAULT 'R0',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE case_states (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  state_json JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  role VARCHAR(32) NOT NULL,
  content_json JSONB NOT NULL,
  message_type VARCHAR(32) NOT NULL DEFAULT 'normal',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE medical_evidence (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  source_title TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_domain VARCHAR(255) NOT NULL,
  credibility VARCHAR(8) NOT NULL,
  source_type VARCHAR(64) NOT NULL,
  related_domain VARCHAR(64),
  summary TEXT NOT NULL,
  extracted_facts JSONB NOT NULL,
  related_hypotheses JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE agent_traces (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  step_index INTEGER NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  input_json JSONB,
  output_json JSONB,
  reason TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE reports (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES cases(id),
  report_type VARCHAR(32) NOT NULL,
  content_json JSONB NOT NULL,
  doctor_summary TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
