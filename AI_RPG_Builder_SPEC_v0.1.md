# AI RPG Builder — Product & Technical SPEC

- 文件版本：v0.1
- 狀態：MVP 開發規格（可供 AI Coding Agent 接續實作）
- 暫定產品名稱：AI RPG Builder
- 產品定位：把故事、世界觀與角色設定轉換成可遊玩的網頁 RPG。
- 核心原則：故事與互動優先；美術先使用合法的現成素材；遊戲資料與引擎分離；先完成一個可玩的垂直切片，再擴充平台能力。

---

## 1. 產品願景

使用者輸入一段故事或世界觀，系統將內容轉換成結構化遊戲資料，並由固定的 RPG Runtime 執行，產生可直接在瀏覽器遊玩的遊戲。

長期方向：
1. AI RPG 生成器。
2. 可持續編輯、測試與發布的 AI World Studio。
3. 可擴充至互動式學習、模擬器與任務工具的資料驅動互動引擎。

**MVP 的目標不是證明 AI 能寫程式，而是證明 AI 能把故事可靠地轉成可執行、可玩的遊戲內容。**

## 2. MVP 成功標準

MVP 至少要讓使用者能：
- 建立一個 RPG 專案。
- 貼上一段故事或世界觀。
- 產生一個包含地圖、NPC、任務、對話、物品和結局的可玩原型。
- 在瀏覽器中移動角色、與 NPC 互動、完成任務、作出選擇。
- 重新整理後保留遊戲進度（至少本機存檔）。
- 修改故事或任務內容，而不需要重新編寫整個引擎。
- 使用一個分享／預覽模式讓他人試玩。

MVP 暫不要求：
- GTA 等級的 3D 開放世界。
- 多人連線。
- 即時語音 NPC。
- 完整的素材市場。
- 任意生成與執行未受控程式碼。
- 付費、訂閱與正式商業化機制。

## 3. 目標使用者

主要使用者：
- 有故事、小說或世界觀，但不會製作遊戲的創作者。
- 想快速製作敘事型 RPG 原型的獨立開發者。
- 想以遊戲方式呈現教材、任務或互動體驗的設計者。

主要使用情境：
1. 使用者貼上故事。
2. AI 整理成角色、地點、任務、對話和事件。
3. 使用者檢視與修改生成內容。
4. 系統驗證資料結構和任務條件。
5. 使用者進入遊戲試玩。
6. 使用者保存專案或分享預覽。

## 4. 產品體驗與主要流程

### 4.1 建立專案
- 輸入專案名稱。
- 輸入故事／世界觀。
- 可選擇類型：奇幻、現代、科幻、懸疑。
- 可選擇遊戲視角：MVP 只實作 2D 俯視角。
- 可選擇敘事風格：輕鬆、嚴肅、黑暗、冒險。

### 4.2 生成遊戲
AI 將故事轉成符合 schema 的結構化資料，包括：
- 遊戲基本資訊。
- 地圖和可行走區域。
- 玩家角色。
- NPC。
- 任務與任務步驟。
- 對話和選項。
- 物品／獎勵。
- 結局條件。

生成後必須執行 schema validation 與基本邏輯驗證。驗證失敗時，顯示可理解的錯誤並允許重試或修復。

### 4.3 編輯
MVP 先提供簡單的表單／JSON 檢視器，至少能編輯：
- 專案名稱、簡介。
- NPC 名稱、描述、位置。
- 對話文字和選項。
- 任務標題、描述、目標、獎勵。
- 遊戲開場和結局文字。

編輯器不應要求使用者直接修改程式碼。

### 4.4 試玩
- 2D 俯視角地圖。
- 鍵盤方向鍵或 WASD 移動。
- NPC 顯示名稱。
- 靠近 NPC 後按 E／空白鍵互動。
- 顯示對話框和選項。
- 任務追蹤 UI。
- 背包／物品清單。
- 玩家狀態和遊戲進度。
- 存檔與載入。

### 4.5 發布／分享
MVP 可先提供「預覽連結」或本機分享模式。若尚未完成帳號與雲端儲存，不要宣稱已支援公開持久化發布。資料可先以專案 JSON 匯出／匯入。

## 5. 技術建議

以下是預設方案，可依現有 repository 調整。若已有可用架構，優先沿用，不要無故整個重寫。

- 前端：React + TypeScript。
- Web 框架：Next.js（若現有專案已採其他框架，沿用現有框架）。
- 遊戲渲染：Phaser 3（適合 2D 遊戲）；若已有穩定的 2D renderer，可沿用。
- Schema 驗證：Zod 或 JSON Schema。
- 專案資料與玩家存檔：MVP 先使用 localStorage／IndexedDB；若需跨裝置再加入 PostgreSQL/Supabase。
- AI：透過 server-side API route 呼叫模型；API key 不得暴露在前端。
- 測試：Vitest（單元測試）及 Playwright（關鍵使用者流程）。
- 部署：相容於所選框架的標準 Web hosting。

### 5.1 架構原則
**AI 只產生／修改結構化遊戲資料，RPG Runtime 負責執行資料。**
AI 不得在 MVP 中直接輸出並執行任意 JavaScript。
遊戲內容與 renderer、任務系統、素材映射分離。
所有生成結果都必須通過 schema 驗證。
任務與事件狀態應由確定性的遊戲邏輯管理，不依賴每次呼叫 AI 來決定。

## 6. 建議資料模型

以下為概念 schema，開發時需轉成正式 TypeScript types 與 runtime validation。

```ts
type GameProject = {
  schemaVersion: "1.0";
  id: string;
  title: string;
  description: string;
  genre: "fantasy" | "modern" | "sci-fi" | "mystery";
  startSceneId: string;
  player: PlayerDefinition;
  scenes: SceneDefinition[];
  npcs: NPCDefinition[];
  quests: QuestDefinition[];
  items: ItemDefinition[];
  endings: EndingDefinition[];
  assetManifest: AssetManifest;
};

type PlayerDefinition = {
  name: string;
  description?: string;
  startPosition: { sceneId: string; x: number; y: number };
  baseStats: { hp: number; level: number; xp: number };
  inventoryItemIds: string[];
};

type SceneDefinition = {
  id: string;
  name: string;
  width: number;
  height: number;
  tileSize: number;
  backgroundAssetId?: string;
  tilesetId?: string;
  walkable: boolean[][];
  exits: Array<{
    x: number; y: number;
    targetSceneId: string;
    targetX: number; targetY: number;
  }>;
  npcIds: string[];
};

type NPCDefinition = {
  id: string;
  name: string;
  description: string;
  sceneId: string;
  position: { x: number; y: number };
  spriteAssetId?: string;
  dialogueNodeId: string;
  questIds?: string[];
};

type DialogueNode = {
  id: string;
  speaker: string;
  text: string;
  choices?: Array<{
    id: string;
    text: string;
    nextNodeId?: string;
    effects?: GameEffect[];
    condition?: GameCondition;
  }>;
};

type QuestDefinition = {
  id: string;
  title: string;
  description: string;
  startCondition?: GameCondition;
  objectives: QuestObjective[];
  rewards?: GameEffect[];
};

type QuestObjective = {
  id: string;
  type: "talk_to_npc" | "collect_item" | "reach_location" | "make_choice";
  targetId: string;
  description: string;
  requiredCount?: number;
};

type ItemDefinition = {
  id: string;
  name: string;
  description: string;
  iconAssetId?: string;
  stackable?: boolean;
};

type EndingDefinition = {
  id: string;
  title: string;
  text: string;
  condition: GameCondition;
};

type GameCondition =
  | { type: "quest_completed"; questId: string }
  | { type: "has_item"; itemId: string; count?: number }
  | { type: "flag_equals"; flag: string; value: string | number | boolean }
  | { type: "stat_at_least"; stat: "hp" | "level" | "xp"; value: number };

type GameEffect =
  | { type: "give_item"; itemId: string; count?: number }
  | { type: "add_xp"; amount: number }
  | { type: "set_flag"; flag: string; value: string | number | boolean }
  | { type: "complete_quest"; questId: string };

type AssetManifest = {
  assets: Array<{
    id: string;
    kind: "tileset" | "character" | "portrait" | "icon" | "background" | "audio";
    src: string;
    license: string;
    attribution?: string;
  }>;
};
```

### 6.1 重要的 schema 規則
- ID 在各自集合內必須唯一。
- 所有 scene、NPC、quest、item、dialogue 和 asset 參照都必須存在。
- 地圖寬高與 walkable 陣列尺寸必須一致。
- 角色與 NPC 位置不得超出地圖。
- dialogue 的 nextNodeId 必須指向存在的節點。
- 任務目標必須指向有效 NPC、物品或地點。
- 任務依賴不得形成無法解鎖的循環，除非明確支援循環任務。
- 不允許未定義的 effect 或 condition。
- 未知的 schemaVersion 必須拒絕或進入明確的 migration 流程。

## 7. 美術與素材策略

MVP 不自行打造完整美術管線，也不把 AI 圖像生成當成阻塞條件。

### 7.1 素材優先順序
1. 自製 placeholder：色塊、簡單 icon、幾何角色。
2. 使用授權明確的免費素材包。
3. 之後才加入 AI 生成素材或付費素材市場。

### 7.2 可研究的素材來源
- Kenney：大量遊戲素材，逐項確認對應素材包授權與署名要求。
- OpenGameArt：每個素材可能採用不同授權，必須逐項核對。
- itch.io 免費素材：依作者與素材包授權為準。
- 自製 SVG／簡單幾何 placeholder。

不得因為素材「可以免費下載」就假設可商用或可再散布。每個外部素材都要記錄來源、作者、授權名稱、署名要求與下載日期。不要直接把其他遊戲的圖像、角色或音樂抓來使用。

### 7.3 Asset Manifest
每項素材至少要記錄：
- assetId
- sourceUrl
- author
- license
- attributionText
- filePath
- assetType

遊戲資料只引用 assetId，不直接依賴素材來源網站的 URL，方便日後替換素材。

## 8. AI 生成流程

### 8.1 建議流程
1. 接收使用者故事。
2. 先生成遊戲概要與缺少資訊的合理預設，不要不必要地反覆詢問。
3. 將概要轉成 GameProject JSON。
4. 驗證 schema。
5. 驗證引用、地圖、任務依賴、對話節點與結局可達性。
6. 對錯誤進行有限次修復重試。
7. 顯示生成結果與驗證狀態。
8. 使用者可修改後再次驗證或試玩。

### 8.2 AI 輸出限制
- 必須符合固定 schema。
- 不得輸出額外說明文字取代 JSON payload。
- 不得在生成資料中加入可執行腳本。
- 不可假裝已完成實際驗證；驗證必須由程式執行。
- 不可自行引用不存在的素材或虛構授權。
- 如未配置 AI API key，提供明確的 demo fixture，讓使用者仍可體驗完整遊戲流程。

### 8.3 Prompt 分層
- System／developer prompt：規定 schema、限制與安全原則。
- User story：故事和創作要求。
- Runtime context：可用的素材 ID、遊戲機制、限制。
- Validation feedback：程式實際回傳的錯誤，供有限次修復使用。

不要把所有規則只寫在一大段 prompt 裡。關鍵規則應由 schema、程式驗證與測試保障。

## 9. 遊戲 Runtime 功能

MVP 只需要實作最基本、但端到端完整的循環：

1. 載入 GameProject。
2. 渲染場景與地圖。
3. 處理玩家移動和碰撞。
4. 顯示 NPC 與互動距離。
5. 開啟對話。
6. 顯示選項並套用 effects。
7. 更新任務目標和狀態。
8. 更新物品、XP 和旗標。
9. 檢查結局條件。
10. 自動儲存玩家進度。

任務、物品和旗標狀態需與靜態的 GameProject 定義分離，避免玩家進度污染原始專案資料。

建議區分：
- `GameProject`：設計內容，版本化、可匯出。
- `PlayerSave`：玩家目前狀態。
- `ProjectMetadata`：編輯器專案資訊與修改時間。

## 10. 建議 UI／頁面

### `/`
- 產品介紹。
- 建立新遊戲。
- 載入 demo。

### `/studio/:projectId`
- 左側：專案內容導覽（概要、場景、NPC、任務、素材）。
- 中央：內容編輯區。
- 右側：AI 指令區或生成結果。
- 顯示驗證錯誤與警告。
- 「試玩」按鈕。

### `/play/:projectId`
- 遊戲畫面。
- 任務追蹤。
- 對話框。
- 背包／角色狀態。
- 存檔狀態。

MVP 可先用簡化版 Studio，不必先做複雜的拖拉式地圖編輯器。

## 11. API 草案

依實際框架調整路由與命名。

- `POST /api/projects/generate`
  - Input：story、genre、preferences
  - Output：符合 schema 的 GameProject、validation report

- `POST /api/projects/validate`
  - Input：GameProject
  - Output：errors、warnings、isValid

- `POST /api/projects/repair`
  - Input：GameProject、validation errors
  - Output：修復後的 GameProject

- `POST /api/projects/export`
  - Input：GameProject
  - Output：JSON download

若採用前端本機存檔，MVP 可以暫時不實作持久化 CRUD API。所有會使用 AI provider 的路由都必須在伺服器端執行。

## 12. 安全、隱私與可靠性

- API key 只能放在 server-side environment variables。
- 不執行 AI 生成的任意程式碼。
- 驗證使用者上傳或匯入的 JSON。
- 限制輸入長度、生成大小、重試次數與請求頻率。
- 對外部素材 URL 採取 allowlist 或安全載入策略，避免任意 URL 造成風險。
- 不把玩家個資或 secrets 放進 AI prompt。
- 儲存前檢查資料大小與 schemaVersion。
- 對 AI 失敗、逾時、格式錯誤提供可理解的錯誤訊息。
- 保留原始版本或提供 undo，避免 AI 修改不可逆地覆蓋使用者內容。

## 13. 測試與驗收條件

### 13.1 端到端驗收
- 使用者能建立專案並輸入故事。
- 使用 demo fixture 或已設定的 AI provider 產生合法 GameProject。
- 場景能正確顯示。
- 玩家可移動，且不會穿越不可行走區域。
- 玩家能與指定 NPC 互動。
- 對話選項能套用效果。
- 完成任務後，任務狀態與獎勵正確更新。
- 達到結局條件時顯示正確結局。
- 重新整理後，玩家存檔仍可載入。
- 匯出再匯入專案後，核心內容保持一致。
- 無效的 JSON 或無效參照會被拒絕並顯示錯誤。
- 無 AI API key 時，demo 流程仍可完整試玩。

### 13.2 單元測試
至少測試：
- schema validation。
- 任務條件判定。
- effect 套用。
- 背包增減。
- 對話節點跳轉。
- 結局條件。
- 存檔／讀檔。
- 地圖碰撞。

## 14. 開發階段

### Phase 0：Repository 檢查
- 檢查既有專案結構、框架、套件、啟動方式和測試。
- 保留現有可用功能。
- 提出最小變更方案，不要先大規模重構。

### Phase 1：固定 Demo RPG
- 使用手寫 fixture，不依賴 AI API。
- 完成一張小地圖、玩家、2 個 NPC、1 個任務、1 個道具和 1 個結局。
- 完成移動、互動、對話、任務、存檔。
- 這是整個專案最重要的垂直切片。

### Phase 2：資料模型與驗證
- 建立 GameProject types/schema。
- 建立引用檢查、任務檢查與對話圖檢查。
- 建立 JSON 匯入／匯出。

### Phase 3：AI 故事轉資料
- 加入 server-side AI adapter。
- 讓故事生成 GameProject。
- 加入 validation、有限次 repair 和錯誤呈現。
- 無 API key 時退回 demo fixture。

### Phase 4：Studio 編輯器
- 編輯故事、NPC、任務、對話。
- 支援 AI 局部修改。
- 保留版本或 undo。
- 即時驗證並試玩。

### Phase 5：素材與分享
- 建立素材 manifest。
- 導入授權明確的素材包。
- 加入專案分享／發布策略。
- 再依測試結果評估更多遊戲類型。

## 15. MVP 的範圍控制

第一個可玩的 Demo 建議只包含：
- 一張小型 2D 地圖。
- 一個玩家角色。
- 兩個 NPC。
- 一條主線任務。
- 一個可取得的道具。
- 兩到三個對話選擇。
- 至少兩種結局或任務結果。
- 本機存檔。
- 一個 demo 專案 JSON。

先確保這個小世界可以完整玩完，再把生成能力加上去。不要一開始就做大型地圖、自由戰鬥系統、多人連線、複雜經濟或任意 3D 場景。

## 16. 給 AI Coding Agent 的開發指令

請先檢查目前 repository，再依照本 SPEC 開發。不要只回覆建議或貼出範例程式碼，應直接在現有專案中實作。

工作規則：
1. 先回報目前使用的框架、資料夾結構、啟動命令和測試狀況。
2. 若專案已有架構，優先沿用；只有必要時才更換套件或重構。
3. 先完成 Phase 1 的固定 Demo RPG 垂直切片，再做 AI 生成。
4. 每完成一個階段，執行 lint、typecheck、tests 或專案中對應的檢查。
5. 不得以靜態 mock 畫面冒充可互動功能。
6. 所有按鈕必須有實際行為；未實作的功能要明確標示。
7. AI 輸出必須經過 schema validation；不要執行生成程式碼。
8. 使用 placeholder 或授權明確的素材，不要抓取未授權遊戲素材。
9. 提供 `.env.example`，不得提交真實 API key。
10. 最後回報已完成項目、主要檔案、執行與測試命令、已知限制和下一步。
11. 遇到非阻塞的設計細節，採用簡單合理的預設並記錄，不要因小問題停下來反覆詢問。
12. 如果目前環境不能存取外部 AI API，先完成可由 demo fixture 驅動的完整流程，並把 AI provider 做成可替換介面。

**第一個交付目標：完成一款從開始到結局都能在瀏覽器中實際遊玩的 2D RPG Demo。之後再讓 AI 自動生成同一種格式的遊戲。**
