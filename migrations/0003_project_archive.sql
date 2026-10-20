-- 典藏（軟刪除）：專案不再真的刪除，只標記典藏時間；資料與版本紀錄完整保留，可以還原
ALTER TABLE projects ADD COLUMN archived_at TEXT;
