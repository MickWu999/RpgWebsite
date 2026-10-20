# AI 開發規範

本文件規範 AI agent 如何製作遊戲。適用對象是在 VS Code 裡執行的 Claude Code，也適用於任何能執行終端機指令的 agent。

本專案的目標，是讓使用者只要把故事交給 AI agent，AI 就能幾乎不靠人工，做出一款**可以從頭玩到結局、品質合格**的 RPG。為了確保品質，每個階段都設有**由程式判定的關卡**；AI 不能以「我覺得完成了」為理由往下走。

---

## 1. 核心原則

1. **只透過 Studio 操作 API 修改遊戲**
   - 使用 `npm run game -- apply <id> <ops.json>`。
   - 不得手動整份改寫 `project.json`。
   - Studio 介面背後用的是同一套操作，所以人和 AI 做出來的結果完全相容。
2. **小步前進**
   - 每批操作最多約 40 筆。
   - 每批操作後都要執行 `npm run game -- check <id>`，修正 `validation.errors` 之後再繼續。
3. **一章一章做**
   - 長篇遊戲一律按「大綱 → 第 1 章 → 檢查 → 第 2 章 → 檢查 → …」的順序進行。
   - 不得一次產生整款遊戲。
4. **程式說了算**
   - 能不能玩：交給 `check`（驗證、自動試玩、品質指標）判定。
   - 好不好玩：交給 `review`（由另一個 AI 獨立審查）判定。
   - 兩者都通過，才能 `publish`。
5. **只使用素材庫裡的素材**：地形字元、角色、圖示、音樂都只能用 `src/game/assets.ts` 中列出的項目；不得虛構素材或授權。
6. **不抄襲**：參考網路上的資料時，只能取用共同經驗、題材或設計原則，不得改寫特定作品的情節或台詞，也不得使用真實人名或可以辨識出特定個人的事件。

## 2. 製作流程

所有遊戲原始檔都放在 `content/<id>/` 底下。

| 階段 | 動作 | 產出 | 關卡 |
|---|---|---|---|
| 0. 建立 | `npm run game -- new <id> --title <名稱> --genre <類型>` | `project.json` 骨架 | — |
| 1. 故事 | 寫入原始故事；若使用者只給一句話，由 AI 擴寫成 800～2000 字 | `story.md` | 有角色、衝突、轉折 |
| 2. 劇本大綱 | 依「4. 劇本大綱格式」撰寫 | `treatment.md` | 3 章、每章都有轉折與關鍵抉擇；角色要有動機和秘密；2～4 個結局各有不同的意義 |
| 3. 世界 | 建立地圖、繪製地形、設定出口與背景音樂 | 操作：`scene.add`、`scene.paint`、`exit.upsert`、`scene.update` | `check` 沒有地圖相關錯誤 |
| 4. 逐章實作 | 每章新增 NPC、對話、調查點、物品、任務 | 每章一批或數批操作 | 每章結束時，`check` 的 `validation.errors` 必須清空 |
| 5. 結局 | 用 `ending.upsert` 取代佔位結局，並加上結局尾聲（epilogues） | 操作 | `check` 的 `ok` 必須為 true（自動試玩找得到每個結局，且沒有卡死） |
| 6. 審查 | `npm run game -- review <id>` | `review.json` | `passed: true`，否則依審查意見修改後重新審查，最多 3 輪 |
| 7. 發布 | `npm run game -- publish <id>`，接著 `npm run deploy` | `public/games/<id>/` | 只有 check 與 review 都通過，才能發布 |

如果審查修改 3 輪後仍然不通過，**請停下來並回報使用者**。附上審查意見，不得自行放寬門檻。

## 3. 品質門檻（由程式強制）

| 項目 | 標準 | 來源 |
|---|---|---|
| 結構 | 引用都存在、地圖走得到、對話節點都接得上、任務依賴沒有循環 | `validate.ts` |
| 可玩 | 每個結局都有路線，而且沒有卡死狀態 | `playtest.ts` |
| 規模 | NPC 5～10 位、對話節點最多 140 個、結局 2～4 個、調查點至少 2 個 | `quality.ts` |
| 時長 | 一般玩家預估 25～40 分鐘 | `quality.ts`（`duration`） |
| 敘事 | 沒有死旗標（設定了卻從沒被讀取）、每個結局至少由 2 個條件組成、各結局的選擇路線彼此不同 | `quality.ts` |
| 內容品質 | 總分 ≥ 7、每項 ≥ 6、沒有 critical、major 最多 1 個 | `review.ts`（獨立 AI 審查） |

敘事設計準則（A～G 共 28 條，例如分支與瓶頸、真正的兩難、互動回饋）見 `src/ai/designGuide.ts` 與 `docs/narrative-design-guide.md`。**寫劇本大綱與對話之前，請先讀過一遍。**

## 4. 劇本大綱格式（`treatment.md`）

```markdown
# 遊戲名稱
一句話：……
主題：……

## 角色（5～10 位）
- 名稱（角色定位）｜想要：……｜秘密：……｜說話風格：……｜角色圖：char_xxx｜聲音：low/mid/high、slow/normal/fast、soft/bright/buzzy

## 地圖（3～5 張）
- id／名稱：用途、背景音樂情緒（peaceful/lively/adventure/mysterious/tense/melancholy）、主要地形

## 第 1 章：標題
目標：……
劇情節拍：1. … 2. … 3. …
轉折：……
關鍵抉擇：……（旗標：xxx）
任務目標：talk_to_npc／collect_item／reach_location／make_choice／inspect …

（第 2 章、第 3 章格式同上）

## 支線（1～2 條）
- 標題｜委託人｜開端｜結果如何影響結局或尾聲

## 結局（2～4 個）
- 標題｜條件（至少 2 個旗標或狀態）｜意義｜尾聲：哪些選擇會追加哪些描述
```

## 5. 操作 API 速查

完整的 JSON Schema 可以用 `npm run studio -- --schema` 取得。常用操作如下：

| 操作 | 用途 |
|---|---|
| `scene.add` `{id,name,width,height,fill?}` | 新增地圖（外圍會自動用樹圍起來） |
| `scene.paint` `{sceneId,cells:[{x,y,ch}]}` | 繪製地形（字元見 `TERRAIN`）；`walkable` 會自動推導 |
| `scene.update` `{id,music}` | 設定背景音樂 |
| `exit.upsert` `{sceneId,exit:{x,y,targetSceneId,targetX,targetY,label}}` | 出口；雙向通行要在兩張地圖各放一個 |
| `npc.upsert` `{npc}` | 新增或修改 NPC；`scene.npcIds` 會自動維護 |
| `interactable.upsert` `{sceneId,object}` | 調查點（門、告示、寶箱）；用 `dialogueVariants` 依條件改變回應 |
| `dialogue.upsert` `{node}` | 對話節點（choices、effects、condition） |
| `quest.upsert`／`item.upsert`／`ending.upsert` | 任務、物品、結局 |
| `player.update` `{start,name,spriteAssetId}` | 主角與起點 |
| `project.update` `{title,description,intro,cover}` | 遊戲資訊與封面 |

**新增時的順序**：先新增會被引用的東西，再新增引用它的東西。例如先 `dialogue.upsert`，再 `npc.upsert`。

## 6. 常見錯誤（審查最常退件的原因）

1. **台詞與道具狀態不一致**：台詞說「給你」，卻沒有 `give_item`。
2. **互斥的抉擇可以重複做**：選了 A 之後還能回頭選 B。解法是用條件隱藏另一個選項。
3. **主要選擇在結局完全沒被提到**：用 `ending.epilogues` 回應這個選擇。
4. **結局文字描述了玩家不一定經歷過的事**：結局文字只能寫該結局條件保證會成立的事。
5. **假選擇**：每個選項都導向同一個節點，而且沒有任何差異。
6. **用來回跑腿灌水來湊時長**：時長應該來自劇情揭露、抉擇和探索。
7. **鎖住的東西沒有提示解法**：例如「門鎖著」之後，必須提示要去找誰。

## 7. 已上線遊戲的更新與擴充

- 已發布的遊戲**不得刪除或改名**既有的 ID，包括 NPC、對話、任務、物品、旗標和地圖。玩家的存檔會用到這些 ID。
- 新內容只能**新增**。如果要改變劇情，請新增新的對話分頁或節點，舊的節點保留下來，必要時可以讓它變成永遠不會出現。
- 擴充內容請用新的地圖和章節，透過新的出口或「通關後解鎖」的條件接上原本的遊戲。

## 8. 回報格式

完成或停下來時，請回報以下內容：

- 遊戲 ID 與名稱
- 預估時長
- 結局數
- 審查分數
- 如果沒有通過：失敗的關卡，以及審查意見
- 發布狀態
