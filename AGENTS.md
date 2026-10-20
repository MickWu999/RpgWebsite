# AGENTS.md — 給 AI 開發者的操作手冊

這份手冊寫給在這個 repo 工作的 AI coding agent（例如 Claude Code）。產品規格見 `AI_RPG_Builder_SPEC_v0.1.md`。

## 核心原則

1. **引擎固定，遊戲是資料**：遊戲內容一律寫成 `GameProject` JSON，由 runtime 執行。任何情況下都不產生或執行遊戲專屬的程式碼。
2. **AI 只挑素材，不畫圖、不作曲**：圖像、音效和音樂都來自 `src/game/assets.ts` 的素材庫，而且全部是 CC0。資料裡只能引用素材 ID，不能寫網址。
3. **驗證由程式負責**：判斷能不能玩、會不會卡關，交給 `validate`、`playtest`、`quality`；AI 審查只負責判斷內容品質。
4. **無人值守，但保留安全閥**：只有狀態為 `approved` 的遊戲可以自動發布；`needs_human_review` 不得自動發布。

## 常用指令（都可以直接執行，輸出也都能被機器讀取）

```bash
npm run validate -- <project.json|demo> --json   # 結束碼 0 表示全部通過
npm run generate -- <story.txt> --json           # 結束碼 0=approved, 3=needs_human_review, 2=失敗
npm run review -- <project.json> --story <story.txt> --json
npm run check                                    # 修改程式後必須跑：lint、typecheck、build
```

這個專案依使用者要求**不寫單元測試**。要確認功能正常，請用 `validate`（包含自動試玩），或實際開瀏覽器驗證。

## 目錄結構

| 路徑 | 內容 |
|---|---|
| `src/game/schema.ts` | GameProject 的 Zod schema（相對 SPEC 的擴充寫在檔案開頭的註解） |
| `src/game/engine.ts` | 確定性的遊戲邏輯，全部是純函式：移動、對話、任務、物品、結局 |
| `src/game/validate.ts` | 引用、地圖、對話、任務依賴、結局可達性的驗證 |
| `src/game/playtest.ts` | 自動試玩：窮舉行動，找出每個結局的路線和卡死狀態 |
| `src/game/quality.ts` | 量化品質指標，包括規模上限、死旗標、結局條件 |
| `src/game/assets.ts` | 素材庫，包括地形字元、角色、圖示、音效、背景音樂，以及授權紀錄 |
| `src/ai/` | 生成流程：分層 prompt、Claude Code provider、正規化、審查、設計準則 |
| `src/components/game/` | RPG Maker 式的遊戲畫面：標題、訊息、選單、手機操作 |
| `src/components/GameCanvas.tsx` | Phaser 3 渲染層，只負責繪製，不處理遊戲邏輯 |
| `scripts/` | 本機 CLI：validate、generate、review，以及 AI bridge |
| `docs/narrative-design-guide.md` | 敘事設計準則與參考來源 |

## 撰寫或修改 GameProject 的規則

- 地圖使用 `terrain` 字元，可用字元見 `TERRAIN`。`walkable` 由地形推導出來。
- 任務目標會**依序**完成。與 NPC 互動時，會先推進 `talk_to_npc` 目標，然後才挑選對話分支。
- `dialogueVariants` 由上往下取第一個條件成立的分支，所以條件越嚴格的要放越前面。
- 每位 NPC 都要設定 `voice`，每個場景都要設定 `music`，每個結局都要設定 `mood`。
- 規模上限：結局最多 4 個、NPC 最多 6 位、對話節點最多 50 個。超過上限會被品質指標擋下。
- 敘事規則見 `src/ai/designGuide.ts`，其中可以由程式判斷的部分已經寫進 `quality.ts`。

## 程式風格

- TypeScript strict 模式；註解與使用者可見文字一律用繁體中文（台灣用語）。
- React 19 的 lint 規則很嚴格：render 階段不能讀寫 ref，effect 裡不能直接呼叫 setState。
- 網站採靜態輸出（`output: "export"`），所以不能使用 Next.js 的 API routes。需要伺服器的功能請放在 `scripts/`，在本機執行。
