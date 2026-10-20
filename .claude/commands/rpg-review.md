---
description: 對遊戲執行程式檢查與獨立 AI 審查（大綱、各章、整體），回報結果與修改建議
argument-hint: <遊戲 ID> [章節 ID]
---

1. 執行 `npm run game -- [remote] status $ARGUMENTS` 與 `npm run game -- [remote] check <遊戲 ID>`。
2. 有指定章節時，執行 `review <遊戲 ID> --chapter <章節 ID>`；沒有指定時，check 通過就執行整體審查 `review <遊戲 ID>`。
3. 用繁體中文回報以下內容，不要修改任何檔案：
   - 驗證錯誤、整體與每章的試玩結果、時長（全長與每章）、品質指標
   - 審查分數、critical 與 major 問題，並對照 designGuide 的 H 與 X 編號
   - 每個問題對應的具體修改建議，寫成可以直接執行的操作 API 指令
