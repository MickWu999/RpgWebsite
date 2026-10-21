-- 推播通知：玩家同意後的訂閱（瀏覽器推播服務的網址與金鑰），以及後台發出的公告
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,          -- sha256(endpoint)
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  visitor TEXT,                 -- 匿名玩家代號（可能沒有）
  created_at TEXT NOT NULL,
  last_ok_at TEXT
);
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,           -- chapter（新章節）/ update（更新）/ fix（修正）/ new_game（新遊戲推出）
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  url TEXT NOT NULL,            -- 點通知後開啟的站內路徑，例如 /play/?pack=game-xxx
  author TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
