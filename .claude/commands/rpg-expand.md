---
description: 擴充已上線的遊戲：新增章節或支線（只新增、不刪改既有 ID，玩家舊存檔仍可繼續）
argument-hint: <遊戲 ID> <擴充內容說明>
---

請依照 docs/ai-development-spec.md 第 8 節的規則擴充既有遊戲：$ARGUMENTS

1. 先執行 `npm run game -- [remote] inspect <id>` 讀懂目前的內容，並讀 content/<id>/treatment.md 與 `remote status <id>`。
2. 在 treatment.md 加上「擴充章節」的大綱：接在哪裡、新增哪些角色與地圖、伏筆與回收、會影響哪些結局或尾聲。寫好後給使用者看一眼再動工（AI 審查選用）。
3. 只能新增，不得刪除或改名任何既有 ID。新章節同樣一次一章：開章 → 內容 → check → 自己走過每種選擇組合，確認沒有台詞矛盾。
4. 最後執行 check → publish，並回報結果。
