-- 前台：邀請連結（?from=阿華）與玩家自己填的暱稱，用來知道「誰在玩」，不需要 IP
ALTER TABLE play_visitors ADD COLUMN invite TEXT;
ALTER TABLE play_visitors ADD COLUMN nickname TEXT;

-- 後台登入紀錄（安全用途）：Studio 帳號是共用的，記錄 IP 才能發現陌生人登入；保留 90 天
CREATE TABLE IF NOT EXISTS studio_logins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  operator TEXT,
  ip TEXT,
  country TEXT,
  device TEXT,
  success INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_studio_logins_time ON studio_logins (created_at);
