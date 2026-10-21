---
description: 依 AI 開發規範，從故事或 Studio 專案製作一款 1～2 小時、分章節的 RPG（大綱審查 → 一章一章製作與審查 → 整體審查 → 發布）
argument-hint: <故事、題材，或 Studio 專案 ID>
---

請依照 docs/ai-development-spec.md 的流程製作一款新的 RPG。

輸入：$ARGUMENTS

1. 判斷輸入是什麼：
   - 看起來像 Studio 專案 ID（小寫英數字加連字號，例如 `night-watch-x7k2`），而且 `.env.local` 有 `STUDIO_TOKEN`：執行 `npm run game -- remote story <id>` 讀取使用者寫的故事。
   - 否則把輸入當成故事或題材。有 `STUDIO_TOKEN` 時先 `npm run game -- remote create <名稱>`；沒有時用本機模式 `npm run game -- new <id> --title <名稱>`。
2. 動工前執行 `npm run game -- remote lessons <id>`，讀 `content/lessons.md`（通用的規則統計，以及這款遊戲的玩家回饋、遊玩數據與審查意見）；再讀 `src/ai/designGuide.ts` 的 **P（故事的靈魂）**、`CLICHES`（老套清單）、H（前輩方法）與 X（常見盲點），以及規範第 5、6、7 節。
   輸入只有題材或一句話時，先做「提案」：`npm run game -- seeds` 抽種子，寫 `content/<id>/pitches.md`（8～12 個提案，格式見規範第 5 節），淘汰到剩 3 個，**交給使用者挑選後才寫故事**。
   選定後先寫招牌場景給使用者看一眼，再寫大綱；大綱要有 `<!-- 劇透線 -->`。
   大綱送審前，對照 TREATMENT_RUBRIC 逐項自我檢查，在 treatment.md 最後附上「自我檢查表」。
   建議以連載推出：第 1 章通過章節審查後就可以發布（規範第 3 節「連載推出」），之後一章一章補上。
3. 依規範第 3 節的順序執行，每一關都要通過才能往下走：
   - 寫 story.md、treatment.md → 大綱審查 `review-treatment`
   - 骨架 → 一次一章：開章（設定 testStart）→ 內容 → `check`（看 chapters[]）→ 章節審查 `review --chapter`
   - 收尾 → `check` 全部通過 → 整體審查 `review` → `publish`
4. 每批操作最多約 40 筆，送出後立刻 `check`。被關卡擋下時，照錯誤訊息處理，不要嘗試繞過。
5. 審查沒通過時，依審查意見逐條修改。同一關修改 3 輪仍不通過，就停下來回報使用者。
6. 依規範第 9 節的格式回報。
