# AGENTS.md — 給 AI 開發者的操作手冊

這份手冊寫給在這個 repo 工作的 AI coding agent（例如 Claude Code）。產品規格見 `AI_RPG_Builder_SPEC_v0.1.md`。

## 核心原則

1. **引擎固定，遊戲是資料**：遊戲內容一律寫成 `GameProject` JSON，由 runtime 執行。任何情況下都不產生或執行遊戲專屬的程式碼。
2. **AI 只挑素材，不畫圖、不作曲**：圖像、音效和音樂都來自 `src/game/assets.ts` 的素材庫，而且全部是 CC0。資料裡只能引用素材 ID，不能寫網址。
3. **驗證由程式負責**：判斷能不能玩、會不會卡關，交給 `validate`、`playtest`、`quality`；AI 審查只負責判斷內容品質。
4. **無人值守，但保留安全閥**：只有狀態為 `approved` 的遊戲可以自動發布；`needs_human_review` 不得自動發布。

## 製作遊戲：請依照 docs/ai-development-spec.md

製作遊戲的流程是 `npm run game -- new / apply / check / review / publish`，遊戲原始檔放在 `content/<id>/`。

## 常用指令（都可以直接執行，輸出也都能被機器讀取）

```bash
npm run game -- schema                       # 操作 API 的 JSON Schema
npm run game -- inspect <id>                 # 以 RPG Maker 事件清單的形式輸出遊戲內容
npm run game -- check <id>                   # 驗證＋自動試玩＋品質指標；結束碼 0 表示通過
npm run game -- remote <list|pull|apply|check|publish> …   # 操作線上 Studio（需要 STUDIO_TOKEN）
npm run validate -- <project.json> --json    # 檢查任意 project.json
npm run catalog                              # 重建遊戲目錄
npm run check                                # 修改程式後必須跑：lint、typecheck、build
```

這個專案依使用者要求**不寫單元測試**。要確認功能正常，請用 `check`（包含自動試玩），或實際開瀏覽器驗證。

## 目錄結構

| 路徑 | 內容 |
|---|---|
| `src/game/schema.ts` | GameProject 2.0（RPG Maker 式：資料庫、地圖、事件頁、事件指令） |
| `src/game/engine.ts` | 事件直譯器，全部是純函式：移動、觸發、指令執行、存檔對齊 |
| `src/game/commands.ts` | 指令樹的走訪與定位工具 |
| `src/game/validate.ts` | 引用、地形、事件頁、標籤、自動執行迴圈、共用事件遞迴、可達性 |
| `src/game/playtest.ts` | 自動試玩：窮舉「觸發事件／選擇／繼續」，找出每個結局的路線與卡死狀態；也能從章節起點試玩 |
| `src/game/quality.ts` | 量化品質指標：規模、時長、死開關、結局條件 |
| `src/game/assets.ts` | 素材庫（地形字元、角色、圖示、音效、背景音樂）與授權紀錄 |
| `src/studio/ops.ts` | 操作 API：人在 Studio 的編輯與 AI 的修改共用 |
| `src/ai/` | 獨立 AI 審查、設計準則、Claude Code provider |
| `src/components/game/` | 遊戲畫面：標題、訊息、選單、章節標題卡、F9 除錯、手機操作 |
| `src/components/studio/` | RPG Maker 式編輯器：地圖、事件編輯、指令清單、資料庫 |
| `src/components/GameCanvas.tsx` | Phaser 3 渲染層，只負責繪製 |
| `content/<id>/` | 本機模式的遊戲原始檔（story.md、treatment.md、project.json） |
| `public/games/<id>/` | 遊戲模組包；`index.json` 是自動產生的，不要手動修改 |
| `worker/` | Cloudflare Worker：前台（player.ts）與後台 API（studio.ts） |

## 撰寫或修改 GameProject 的規則

- 一律透過操作 API 修改；資料模型與 RPG Maker 的常見寫法見 `docs/ai-development-spec.md` 第 6 節。
- 自動執行頁最後一定要關閉自己（獨立開關或開關），否則驗證會擋下。
- 每個角色都要設定 `voice`，每張地圖都要設定 `music`，每個結局都要設定 `mood`，專案要設定 `cover`。
- 被鎖住的東西一定要給回饋並提示解法；沒有事件的地形，runtime 會用 `TERRAIN[].examine` 給預設回應。
- 敘事規則見 `src/ai/designGuide.ts`，其中可以由程式判斷的部分已經寫進 `quality.ts`。

## 程式風格

- TypeScript strict 模式；註解與使用者可見文字一律用繁體中文（台灣用語）。
- React 19 的 lint 規則很嚴格：render 階段不能讀寫 ref，effect 裡不能直接呼叫 setState。
- 網站採靜態輸出（`output: "export"`），所以不能使用 Next.js 的 API routes。需要伺服器的功能請放在 `scripts/`，在本機執行。
- 前台（`npm run deploy`）與後台（`npm run deploy:studio`）分開部署，互相不連結；前台不能出現任何開發者工具或用語。
