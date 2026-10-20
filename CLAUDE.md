# CLAUDE.md

這個專案的工作方式：使用者在 VS Code 裡把故事交給 AI agent（也就是你），幾乎由 AI 獨自完成 RPG 的製作。

開始任何工作之前，請先讀：

- @AGENTS.md：專案結構、指令、程式風格
- @docs/ai-development-spec.md：製作遊戲的流程、品質門檻、操作 API。製作或修改遊戲時必須遵守。

回覆與遊戲內容一律使用繁體中文（台灣用語）。

可用的斜線指令：

- `/rpg-new <故事或題材>`：從零製作一款新遊戲
- `/rpg-expand <遊戲 ID> <擴充內容>`：擴充已上線的遊戲
- `/rpg-review <遊戲 ID>`：只執行檢查與審查
