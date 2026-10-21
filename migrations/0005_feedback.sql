-- 玩家回饋：玩完一章時留下的星等、標籤與留言（同一位玩家同一章只保留最新一筆）
CREATE TABLE IF NOT EXISTS player_feedback (
  id TEXT PRIMARY KEY,          -- sha256(玩家 IP＋遊戲＋章節)，只用來去重，不保存 IP
  game_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  tags TEXT NOT NULL,           -- JSON 陣列
  comment TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_game ON player_feedback (game_id, chapter_id, created_at);
