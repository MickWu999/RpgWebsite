# AI RPG Builder

把故事、世界觀與角色設定，轉換成可以在瀏覽器遊玩的 2D RPG。

故事會先被轉成結構化的遊戲資料（GameProject JSON），再交給固定的 RPG Runtime 執行。AI 只是產生資料的其中一種方式，也可以直接在 Studio 編輯，或匯入 JSON。

## 快速開始

```bash
npm install
npm run dev            # http://localhost:3000
```

- 試玩 demo：http://localhost:3000/play/?id=demo-lantern
- 操作方式：
  - 鍵盤：方向鍵或 WASD 移動，Z／Enter 確認，X／Esc 開啟選單
  - 手機（請橫向遊玩）：用搖桿移動、點擊地面移動、點擊 NPC 對話

## 指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm run build` | 靜態輸出到 `out/`，可部署到 Cloudflare |
| `npm run check` | lint、typecheck、build |
| `npm run validate -- <project.json\|demo> [--json]` | 驗證遊戲資料、執行自動試玩、計算品質指標 |
| `npm run generate -- <故事.txt> [--json]` | 用本機 Claude Code 從故事生成遊戲，全程自動驗證與審查 |
| `npm run review -- <project.json> --story <故事.txt>` | 對既有遊戲執行獨立的 AI 審查 |
| `npm run ai` | 啟動本機 AI bridge，讓網頁上的「AI 生成」按鈕可以使用 |

## AI 生成（本機 Claude Code，不需要 API key）

AI 生成使用本機已登入的 Claude Code CLI，只能在本機執行。部署到 Cloudflare 的網站不會呼叫 AI。

1. 建立 `.env.local`，參考 `.env.example`，設定 `CLAUDE_CLI_PATH`。
2. 執行 `npm run generate -- examples/stories/mountain-herbalist.txt`。

生成流程與最終狀態：

- 流程：生成 → 驗證 → 自動試玩 → 修復 → 品質指標 → 獨立 AI 審查 → 依意見修改
- 最終狀態只有兩種：`approved`（可以發布）或 `needs_human_review`（不會自動發布）

## 部署

`npm run build` 會產生純靜態的 `out/`，可以直接部署到 Cloudflare（Workers 靜態資源或 Pages）。

- 遊戲進度存在玩家瀏覽器的 localStorage。
- 換裝置或清除網站資料之前，請先匯出 JSON 備份。

## 素材授權

所有美術與音樂都使用 CC0 素材，詳細紀錄見 `src/game/assets.ts` 的 `LICENSES`：

- 圖像：Kenney 的 Tiny Town、Tiny Dungeon
- 音效：Kenney 的 RPG Audio、Interface Sounds、Music Jingles
- 背景音樂：Juhani Junkala 的 JRPG Music Pack
