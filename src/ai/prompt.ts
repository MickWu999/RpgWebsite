import { ASSET_CATALOG, TERRAIN } from "@/game/assets";
import type { ValidationIssue } from "@/game/validate";
import { DESIGN_GUIDE } from "./designGuide";

/**
 * Prompt 分層（SPEC §8.3）：
 * - SYSTEM_PROMPT：角色、schema 與安全限制（透過 --system-prompt 傳入）
 * - runtimeContext()：可用素材 ID、地形字元、遊戲機制
 * - 使用者故事與偏好
 * - 驗證回饋：只放程式實際回傳的錯誤
 * 關鍵規則仍由 schema（--json-schema）與 validate.ts 保障，不只依賴 prompt。
 */

export const SYSTEM_PROMPT = `你是「AI RPG Builder」的遊戲資料設計器。你的唯一工作是把使用者的故事轉成一份符合 JSON Schema 的 2D 俯視角 RPG 結構化資料。

硬性規則：
1. 只輸出符合 schema 的結構化資料，不要輸出說明文字、Markdown 或程式碼。
2. 不得在任何欄位中放入可執行腳本、HTML 或 URL。
3. 只能使用 runtime context 列出的素材 ID 與地形字元；不得虛構素材或授權。
4. 所有 ID 使用英數字、底線或連字號；同一集合內不得重複；所有引用必須指向存在的項目。
5. 遊戲邏輯只能用 schema 定義的 condition 與 effect 表達。
6. 故事缺少的資訊請自行補上合理預設，不要反問使用者。
7. 所有玩家可見文字（名稱、描述、對話、任務、結局）使用繁體中文（台灣用語），除非使用者故事明確使用其他語言。`;

export function runtimeContext(): string {
  const terrain = Object.entries(TERRAIN)
    .map(([ch, d]) => `  "${ch}" = ${d.name}（${d.walkable ? "可行走" : "不可行走"}）`)
    .join("\n");
  const characters = ASSET_CATALOG.filter((a) => a.kind === "character")
    .map((a) => `  ${a.id}：${a.name}［${a.tags.join(", ")}］`)
    .join("\n");
  const icons = ASSET_CATALOG.filter((a) => a.kind === "icon")
    .map((a) => `  ${a.id}：${a.name}［${a.tags.join(", ")}］`)
    .join("\n");

  return `<runtime_context>
## 地圖
- 每個場景用 terrain 字串陣列描述：terrain.length = height，每列字元數 = width（建議 16×12，最大 32×24）。tileSize 固定填 40。
- 地圖外圍請用不可行走的地形圍起來；出口格必須是可行走地形（通常放在邊界上，把該格改成 "="）。
- 可用地形字元：
${terrain}
- 場景之間用 exits 連接：玩家踩到 (x,y) 會傳送到 targetSceneId 的 (targetX,targetY)，目標格必須可行走且不是另一個出口。雙向通行需要在兩個場景各放一個出口。
- locations 定義 reach_location 任務目標的區域；pickups 是地圖上可撿取的物品（可用 condition 控制何時出現）。
- NPC 必須站在可行走格上、不可重疊、不可擋住唯一通道，且旁邊至少有一格玩家走得到。
- scene.npcIds 必須列出所有 sceneId 為該場景的 NPC。

## 可用角色素材（spriteAssetId；player 也可設定）
${characters}

## 可用物品圖示（item.iconAssetId）
${icons}

## 聲音（素材庫固定，AI 只選參數）
- 每位 NPC 請設定 voice：pitch（low/mid/high）、speed（slow/normal/fast）、timbre（soft/bright/buzzy），依角色個性設計，讓不同角色聽起來有區別。例如年長、沉穩 → low/slow/soft；孩子、活潑 → high/fast/bright；粗魯、機械 → low/normal/buzzy。
- 每個結局請設定 mood：triumphant（圓滿）、bittersweet（苦樂參半）、somber（沉重）、mysterious（懸疑）。
- 每個場景請設定 music（背景音樂情緒）：peaceful（平和村莊）、lively（熱鬧市集）、adventure（原野冒險）、mysterious（神秘森林、遺跡）、tense（危險、對峙）、melancholy（感傷、失落）。依場景氣氛選擇，相鄰場景最好有對比。
- 走路聲、撿物品、任務完成等事件音效由 runtime 自動播放，不需要設定。

## 一致性規則（審查時常見的錯誤）
- 台詞說「給你某物」時，該選項必須有 give_item；之後要交出或使用的物品，必須先有取得方式。
- 互斥的抉擇（例如二選一的結局選擇）一旦做出，其他 NPC 的對話分支必須用條件隱藏另一個選項，避免玩家重複選擇或覆蓋結果。
- 角色提出的請求或伏筆（例如「請幫我轉告某人」），必須在後續對話或結局中被回應。

## 遊戲機制（由確定性的 runtime 執行）
- 玩家用方向鍵移動，靠近 NPC（相鄰 8 格）按 E 對話。
- NPC 對話入口：dialogueVariants 由上到下第一個條件成立者優先，否則用 dialogueNodeId。條件越嚴格的分支請放越前面。
- 對話節點的 choices：有 nextNodeId 會跳到下一個節點；沒有 nextNodeId 會結束對話。沒有 choices 的節點會顯示「繼續」並結束對話。
- 任務在 startCondition 成立時自動開始（沒有 startCondition 則一開始就進行中）。常見作法：接受任務的選項用 set_flag，任務的 startCondition 用 flag_equals。
- 任務目標「依序」完成：talk_to_npc（開啟與該 NPC 的對話時）、make_choice（選擇指定 choice id 時）、collect_item（背包數量達到 requiredCount）、reach_location（走進地點區域）。
- 互動順序：與 NPC 對話時會先推進 talk_to_npc 目標，再依新狀態挑選對話分支。所以「回報 NPC」若是最後一個目標，任務會在對話開啟前完成，可用 quest_completed 條件顯示收尾對話。
- 任務全部目標完成後自動套用 rewards。每 100 經驗值升 1 級。
- 結局：每次狀態變化後依序檢查 endings 的 condition，第一個成立的就是結局，遊戲結束。至少提供兩種結局，並確保每個結局都有一條可達成的選擇路線（通常最後一段對話用不同選項 set_flag 到不同值）。
- condition 只能是：quest_completed、quest_active、has_item、flag_equals、stat_at_least、all、any、not。
- effect 只能是：give_item、remove_item、add_xp、set_flag、complete_quest。

## 規模建議
- 1～3 個場景、2～5 個 NPC（最多 6）、1～2 條任務、1～4 個物品、2～3 個結局（最多 4）、20～40 個對話節點（最多 50）。超過上限會被程式退回。
- 結局文字只能描述「達成該結局的條件」保證成立的事；不要提到玩家在這條路線上不一定看過的對話或物品。
- 一條主線任務 3～6 個目標，讓玩家能在 10 分鐘內從頭玩到結局。

${DESIGN_GUIDE}
</runtime_context>`;
}

export type StoryPreferences = { title?: string; genre?: string; style?: string };

export function generationPrompt(story: string, prefs: StoryPreferences): string {
  return `${runtimeContext()}

<preferences>
專案名稱：${prefs.title || "（請依故事命名）"}
類型：${prefs.genre || "依故事判斷"}
敘事風格：${prefs.style || "依故事判斷"}
視角：2D 俯視角
</preferences>

<story>
${story}
</story>

請依照上述故事設計一款可以從頭玩到結局的 RPG，輸出符合 schema 的資料。`;
}

export function repairPrompt(previous: unknown, issues: ValidationIssue[]): string {
  const list = issues
    .slice(0, 30)
    .map((i) => `- ${i.path || "(root)"}：${i.message}`)
    .join("\n");
  return `${runtimeContext()}

<current_project>
${JSON.stringify(previous)}
</current_project>

<validation_errors>
以下錯誤由驗證程式實際產生，請修正這些問題，並盡量保留其他內容不變：
${list}
</validation_errors>

請輸出修正後、完整的遊戲資料。`;
}

/** 依品質指標或 AI 審查意見改進（內容層面的修改，結構仍需重新驗證） */
export function revisePrompt(story: string, previous: unknown, feedback: string[]): string {
  return `${runtimeContext()}

<story>
${story}
</story>

<current_project>
${JSON.stringify(previous)}
</current_project>

<review_feedback>
獨立審查與品質檢查指出以下問題，請逐條改進，並維持所有結局都可以達成：
${feedback.map((f) => `- ${f}`).join("\n")}
</review_feedback>

請輸出改進後、完整的遊戲資料。`;
}
