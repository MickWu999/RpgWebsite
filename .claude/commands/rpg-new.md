---
description: 依 AI 開發規範，從故事或 Studio 專案製作一款分章節的 RPG（長度由故事決定）（提案 → 大綱 → 一章一章製作與 check → 發布給真人試玩）
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
   每個提案都要寫出「核心玩法一句話」與主角主動想要的目標。
   建議以連載推出：第 1 章 `check` 通過就發布（規範第 3 節「連載推出」），請使用者和同事試玩，依回饋再做後面的章節。
3. 依規範第 3 節的順序執行，`check` 沒通過不能往下走：
   - 寫 story.md、treatment.md
   - 骨架 → 一次一章：開章（設定 testStart）→ 內容 → `check`（看 chapters[]）→ 自己走過每種選擇組合，確認沒有台詞矛盾
   - 收尾 → `check` 全部通過 → `publish`
4. 每批操作最多約 40 筆，送出後立刻 `check`。被關卡擋下時，照錯誤訊息處理，不要嘗試繞過。
5. AI 審查（`review-treatment`、`review --chapter`、`review`）是選用的：使用者要求、或你對分支矛盾沒把握時才跑一次，只修 critical，不要為了分數反覆重審。
6. 依規範第 9 節的格式回報。
