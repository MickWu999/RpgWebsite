---
description: 對遊戲執行程式檢查與獨立 AI 審查，回報結果與修改建議
argument-hint: <遊戲 ID>
---

1. 執行 `npm run game -- check $ARGUMENTS`。
2. 如果 check 通過，再執行 `npm run game -- review $ARGUMENTS`。
3. 用繁體中文回報以下內容，不要修改任何檔案：
   - 驗證錯誤、試玩結果、品質指標（時長、規模）
   - 審查分數、critical 與 major 問題
   - 每個問題對應的具體修改建議，請寫成可以直接執行的操作 API 指令
