-- AI RPG Studio 後台資料庫（Cloudflare D1）

-- 開發者帳號：密碼以 PBKDF2-SHA256 雜湊後儲存（salt 與迭代次數一併保存）
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- 登入工作階段：cookie 只存隨機 token，資料庫只存它的 SHA-256
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- API Token（類似 Jenkins）：只在建立時顯示一次，資料庫只存 SHA-256
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

-- 專案：目前內容與版本號（樂觀鎖，避免人和 AI 同時修改互相覆蓋）
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  is_valid INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 版本紀錄（類似 Jenkins 建置紀錄）：每次儲存或 AI 操作都留下一版，記錄是誰（人或 token）、做了什麼
CREATE TABLE project_versions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  label TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, version)
);

-- 已發布的遊戲：前台直接讀取這張表
CREATE TABLE published_games (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  catalog TEXT NOT NULL,
  published_at TEXT NOT NULL
);
