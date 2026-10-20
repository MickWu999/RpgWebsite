-- 防暴力破解：記錄登入失敗次數（依帳號與 IP），15 分鐘內失敗 5 次即鎖定
CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
