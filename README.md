# AI RPG Builder

把故事、世界觀與角色設定，轉換成可以在瀏覽器遊玩的 2D RPG。

故事會先被轉成結構化的遊戲資料（GameProject JSON），再交給固定的 RPG Runtime 執行。AI 只是產生資料的其中一種方式，也可以直接在 Studio 編輯，或匯入 JSON。

## 給製作者：clone 下來，交給 AI 做遊戲

不需要雲端帳號，也不需要任何 API key，只要用你自己 VS Code 裡的 Claude Code 就能製作。

```bash
git clone https://github.com/MickWu999/RpgWebsite.git
cd RpgWebsite
npm install
cp .env.example .env.local   # 設定 CLAUDE_CLI_PATH，供 AI 審查使用
code .                       # 用 VS Code 打開
```

在 VS Code 的 Claude Code 裡輸入：

```
/rpg-new 一個關於台灣新兵在懇親會前想挽回家人信任的故事
```

AI 會依照 `docs/ai-development-spec.md` 依序完成以下步驟，幾乎不需要人工介入：

1. 擴寫故事、寫劇本大綱
2. 一章一章用 Studio 操作 API 實作，每一步都經過驗證與自動試玩
3. 交給另一個獨立的 AI 審查
4. 通過後發布到 `public/games/`

完成之後：

- `npm run dev`：在 http://localhost:3000 試玩，或到 `/studio` 用 RPG Maker 式的編輯器手動微調。
- `npm run deploy`：部署到你自己的 Cloudflare。請先把 `wrangler.jsonc` 裡的 `name` 改成你自己的名稱，並執行 `npx wrangler login`。

其他斜線指令：

- `/rpg-expand <遊戲 ID> <擴充內容>`：擴充已上線的遊戲，玩家的舊存檔可以繼續玩。
- `/rpg-review <遊戲 ID>`：只做檢查與審查。

> **`CLAUDE_CLI_PATH`**：AI 審查需要另外啟動一個 `claude` 程序。如果你只安裝了 VS Code 擴充套件，終端機裡沒有 `claude` 指令，請把它設定成擴充套件內附的執行檔路徑，例如 `~/.vscode/extensions/anthropic.claude-code-<版本>/resources/native-binary/claude`。

## 快速開始

```bash
npm install
npm run dev            # http://localhost:3000
```

- 首頁「遊戲庫」可以左右捲動選擇遊戲；直接試玩 demo：http://localhost:3000/play/?pack=demo-lantern
- 遊戲啟動流程：開發者 Logo → 封面（按任意鍵開始）→ 標題選單
- 操作方式：
  - 鍵盤：方向鍵或 WASD 移動，Z／Enter 確認，X／Esc 開啟選單
  - 手機（請橫向遊玩）：用搖桿移動、點擊地面移動、點擊 NPC 對話

## 前台與後台（完全分開的兩個網站）

| | 前台（玩家） | 後台（AI RPG Studio） |
|---|---|---|
| 網址 | https://ai-rpg-builder.wuminzhe9.workers.dev | https://ai-rpg-studio.wuminzhe9.workers.dev |
| 內容 | 遊戲選單與遊戲畫面 | 需要登入：專案管理、總覽與製作清單、RPG Maker 式編輯器、資料庫、測試遊玩、版本紀錄、發布、AI 協作（API Token）、設定、說明 |
| 部署 | `npm run deploy` | `npm run deploy:studio` |

- 兩邊互不連結：前台的 build 會移除後台頁面，後台的 build 也會移除前台頁面。
- 後台的專案存在 Cloudflare D1。在後台按「發布」後，前台會立即出現這款遊戲，不需要重新部署。
- 開發者帳號用 `npm run studio:user -- add <帳號>` 建立，密碼會在本機雜湊後才寫入資料庫。
- AI agent 用 Studio 產生的 API Token 操作後台，做法見 `docs/ai-development-spec.md` 第 2 節。

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
| `npm run catalog` | 驗證 `public/games/` 底下的模組包並產生遊戲目錄（`build`、`dev` 會自動執行） |

## AI 生成（本機 Claude Code，不需要 API key）

AI 生成使用本機已登入的 Claude Code CLI，只能在本機執行。部署到 Cloudflare 的網站不會呼叫 AI。

1. 建立 `.env.local`，參考 `.env.example`，設定 `CLAUDE_CLI_PATH`。
2. 執行 `npm run generate -- examples/stories/mountain-herbalist.txt`。

生成流程與最終狀態：

- 流程：生成 → 驗證 → 自動試玩 → 修復 → 品質指標 → 獨立 AI 審查 → 依意見修改
- 最終狀態只有兩種：`approved`（可以發布）或 `needs_human_review`（不會自動發布）

## 遊戲模組包

每款遊戲都是一個靜態資料夾，引擎與素材所有遊戲共用：

```
public/games/<id>/project.json   遊戲本體（GameProject JSON），玩家選擇後才下載
public/games/<id>/meta.json      狀態：demo 或 approved
public/games/index.json          自動產生的遊戲目錄，內含封面資料，不要手動修改
```

- 只有通過驗證、自動試玩、品質指標，而且狀態是 `demo` 或 `approved` 的遊戲，才會被收錄進目錄。
- `npm run generate -- <故事> --publish`：只有生成結果為 `approved` 時，才會自動發布到這裡。
- 之後若要讓使用者自行發布，可以把這兩個網址換成 API（例如 Cloudflare R2 加上 Worker），資料格式不需要改。

## PWA（可安裝、可離線）

- **Android／Chrome**：首頁會出現「安裝到主畫面」按鈕。
- **iPhone**：點 Safari 的「分享」→「加入主畫面」。從主畫面開啟可以全螢幕遊玩，這是 iPhone 上唯一能全螢幕的方式。
- **離線**：玩過的遊戲離線也能玩。service worker 寫在 `public/sw.js`：網頁一律先抓網路上的新版本，素材則優先使用快取。

## 部署

`npm run deploy` 會先 build，再用 wrangler 部署到 Cloudflare Workers 靜態資源，設定寫在 `wrangler.jsonc`。

- 玩家版：https://ai-rpg-builder.wuminzhe9.workers.dev（`npm run deploy`）
- 開發者版：https://ai-rpg-builder-dev.wuminzhe9.workers.dev（`npm run deploy:dev`，wrangler 的 `env.dev`，另一個 Worker）
  - 線上開發者版的「AI 生成」需要在本機執行 `npm run ai`，並把開發者版網址加進 `AI_BRIDGE_ALLOWED_ORIGINS`（建議用 Chrome）
- 快取設定寫在 `public/_headers`：`sw.js` 和遊戲目錄不快取，素材快取 7 天。

- 遊戲進度存在玩家瀏覽器的 localStorage。
- 換裝置或清除網站資料之前，請先匯出 JSON 備份。

## 素材授權

所有美術與音樂都使用 CC0 素材，詳細紀錄見 `src/game/assets.ts` 的 `LICENSES`：

- 圖像：Kenney 的 Tiny Town、Tiny Dungeon
- 音效：Kenney 的 RPG Audio、Interface Sounds、Music Jingles
- 背景音樂：Juhani Junkala 的 JRPG Music Pack
