-- 完整遊玩紀錄（匿名）：給 AI 案例庫與後台營運使用；不保存 IP 或任何能直接認出個人的資料
ALTER TABLE play_events ADD COLUMN detail TEXT;   -- 選項文字、任務動作、錯誤訊息等（最多 200 字）

-- 匿名玩家：瀏覽器裡隨機產生的代號；裝置與地區只記粗略的分類
CREATE TABLE IF NOT EXISTS play_visitors (
  visitor TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  device TEXT,        -- mobile / tablet / desktop
  os TEXT,            -- iOS / Android / Windows / macOS / Linux / 其他
  browser TEXT,       -- Chrome / Safari / Firefox / Edge / Samsung / 其他
  lang TEXT,          -- 例如 zh-TW
  country TEXT,       -- Cloudflare 判斷的國家或地區代碼，例如 TW
  sessions INTEGER NOT NULL DEFAULT 0
);

-- 遊玩階段：一次開啟遊戲到離開
CREATE TABLE IF NOT EXISTS play_sessions (
  session TEXT PRIMARY KEY,
  visitor TEXT NOT NULL,
  game_id TEXT,
  started_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  events INTEGER NOT NULL DEFAULT 0,
  screen TEXT,        -- 例如 1280x800
  touch_mode TEXT     -- pad / tap / 非觸控為 null
);
CREATE INDEX IF NOT EXISTS idx_sessions_visitor ON play_sessions (visitor, started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_game ON play_sessions (game_id, started_at);
CREATE INDEX IF NOT EXISTS idx_play_events_session ON play_events (session, id);
