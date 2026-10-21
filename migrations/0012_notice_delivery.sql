-- 推播改為發布時自動送出：記錄公告屬於哪款遊戲，以及分批送出的進度（排程每分鐘接著送，直到 done = 1）
ALTER TABLE notices ADD COLUMN game_id TEXT;
ALTER TABLE notices ADD COLUMN cursor TEXT NOT NULL DEFAULT '';
ALTER TABLE notices ADD COLUMN done INTEGER NOT NULL DEFAULT 0;
-- 發這則通知時遊戲有幾章：用來避免重複通知（下架再上架、還原舊版再發布都不會再通知一次）
ALTER TABLE notices ADD COLUMN chapters INTEGER;
-- done：0 待送出、1 已送完、2 基準紀錄（不推播、玩家看不到）。
-- 通知功能上線前就已發布的遊戲，補一筆基準紀錄：之後重新發布不會被當成「新遊戲推出」，只有新章節才通知
INSERT INTO notices (kind, title, body, url, author, game_id, chapters, done, created_at)
SELECT 'new_game', '（基準）' || json_extract(catalog, '$.title'), '通知功能上線前已發布', '/play/?pack=' || id, 'system', id, json_array_length(data, '$.chapters'), 2, published_at
FROM published_games;
