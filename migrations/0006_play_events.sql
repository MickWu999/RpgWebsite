-- 遊玩數據：前台匿名事件（開始遊戲、進入章節、完成章節、抵達結局、離開）
-- visitor 是瀏覽器裡隨機產生的匿名代號，不保存 IP 或任何個人資料
CREATE TABLE IF NOT EXISTS play_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL,
  visitor TEXT NOT NULL,
  session TEXT NOT NULL,
  type TEXT NOT NULL,           -- start / chapter / chapter_done / ending / leave
  chapter_id TEXT,
  ref TEXT,                     -- start：new／continue；ending：結局 ID；leave：所在地圖 ID
  value REAL,                   -- chapter_done：本章花費分鐘；leave：本次遊玩分鐘
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_play_events_game ON play_events (game_id, type, created_at);
