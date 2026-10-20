---
description: 依 AI 開發規範，從故事或題材製作一款 25～40 分鐘的 RPG（大綱 → 逐章實作 → 檢查 → 審查 → 發布）
argument-hint: <故事、題材或故事檔路徑>
---

請依照 docs/ai-development-spec.md 的流程，製作一款新的 RPG。

故事或題材：$ARGUMENTS

要求：

1. 先決定遊戲 ID（小寫英數字加連字號），執行 `npm run game -- new <id> --title <名稱> --genre <類型>`。
2. 依規範第 2 節，依序完成 story.md、treatment.md、世界、逐章實作、結局。
   - 每批操作都用 `npm run game -- apply`，套用後執行 `npm run game -- check`，並修正所有錯誤。
3. `check` 的 `ok` 為 true 之後，執行 `npm run game -- review <id>`。如果沒有通過，依審查意見修改後重新審查，最多 3 輪。
4. 通過之後執行 `npm run game -- publish <id>`。
5. 依規範第 8 節的格式回報。沒有通過時，不要放寬任何門檻，直接回報卡住的原因。
