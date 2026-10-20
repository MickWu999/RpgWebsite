-- AI 製作看板：故事原文、劇本大綱，以及每一次審查（大綱／章節／整體）的結果
CREATE TABLE IF NOT EXISTS project_docs (
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- story | treatment
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (project_id, kind)
);
CREATE TABLE IF NOT EXISTS project_reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,   -- treatment | chapter | full
  target TEXT NOT NULL, -- treatment | 章節 ID | full
  revision TEXT,
  passed INTEGER NOT NULL,
  overall INTEGER,
  data TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_project ON project_reviews (project_id, target, created_at);
