-- 修改清單：人在測試遊玩時按「📌 標記」留下的修改意見，AI 用 remote notes 讀取、修改後標成已處理
CREATE TABLE IF NOT EXISTS project_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  locator TEXT,                 -- 位置代碼，例如 town/mira/p2#3（沒有在執行事件時為 null）
  map_id TEXT,
  x INTEGER,
  y INTEGER,
  chapter_id TEXT,
  excerpt TEXT,                 -- 當下畫面上的台詞
  state TEXT,                   -- JSON：打開的開關、變數、物品、任務（幫 AI 重現情境）
  body TEXT NOT NULL,           -- 人的意見
  author TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',   -- open / resolved / wontfix
  resolution TEXT,              -- AI 或人怎麼處理的
  resolved_by TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_project ON project_notes (project_id, status, created_at);
