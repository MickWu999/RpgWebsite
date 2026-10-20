---
description: 擴充已上線的遊戲（只新增、不刪改既有 ID，玩家舊存檔仍可繼續）
argument-hint: <遊戲 ID> <擴充內容說明>
---

請依照 docs/ai-development-spec.md 第 7 節的規則，擴充既有遊戲：$ARGUMENTS

1. 先執行 `npm run game -- inspect <id>`，讀懂目前的內容，以及 content/<id>/treatment.md。
2. 在 treatment.md 加上「擴充章節」的大綱：要接在哪裡、新增哪些角色和地圖、會影響哪些結局或尾聲。
3. 只能新增，不得刪除或改名任何既有 ID。用新地圖、新出口或「通關後解鎖」的條件接上主線。
4. 照常執行 apply → check → review → publish，並回報結果。
