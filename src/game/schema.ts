import { z } from "zod";

/**
 * GameProject 2.0：以 RPG Maker（MZ）的資料模型為基底。
 *
 * - 資料庫：角色（actors）、物品、任務日誌、結局、章節、共用事件、開關、變數、系統。
 * - 地圖：圖塊地形＋地圖樹（parentId）＋事件。
 * - 事件：多個事件頁；系統每次都選「條件成立、編號最大」的那一頁。
 *   每頁有出現條件、圖像、觸發方式（確定鍵／接觸／自動執行）、優先度（在角色下／同層／在角色上）與執行內容（事件指令列）。
 * - 事件指令：顯示文字、顯示選項、條件分支、開關／獨立開關／變數操作、增減物品、任務、場所移動、結局、章節、共用事件、標籤／跳轉等。
 *
 * 與 RPG Maker 不同之處（為了 AI 製作與無戰鬥的敘事遊戲）：
 * - 開關、變數、事件都用文字 ID（例如 `met_sergeant`），比 0001 這類編號容易閱讀與引用。
 * - 事件頁出現條件多一格「進階條件」（任意條件組合）；顯示選項的每個選項可以設定出現條件。
 * - 內建任務日誌（quests）、結局畫面（endings＋尾聲）、章節（chapters＋章節標題卡、從某章開始測試）。
 * 不在 schema 中的指令或條件一律拒絕（strict object + discriminated union）。
 */

export const SCHEMA_VERSION = "2.0" as const;

export const idSchema = z
  .string()
  .min(1, "ID 不可為空")
  .max(64, "ID 長度不可超過 64")
  .regex(/^[A-Za-z0-9_-]+$/, "ID 只能包含英數字、底線與連字號");

const shortText = z.string().min(1).max(200);
const longText = z.string().max(4000);
const coord = z.number().int().min(0).max(255);

export const DIRECTIONS = ["up", "down", "left", "right"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const SELF_SWITCHES = ["A", "B", "C", "D"] as const;
export type SelfSwitchKey = (typeof SELF_SWITCHES)[number];
export const QUEST_STATUSES = ["inactive", "active", "completed", "failed"] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];
export const COMPARE_OPS = ["==", "!=", ">=", "<=", ">", "<"] as const;
export const MUSIC_MOOD_IDS = ["peaceful", "lively", "adventure", "mysterious", "tense", "melancholy"] as const;
/** 地圖與標題畫面的音樂：情緒標籤，或 none（不放音樂，只留環境音） */
export const MAP_MUSIC_IDS = [...MUSIC_MOOD_IDS, "none"] as const;
/** 環境音（循環，疊在音樂下面或單獨播放）：雨聲、海浪、風鈴、深夜的空氣聲 */
export const AMBIENCE_IDS = ["rain", "waves", "chimes", "night"] as const;
export const ENDING_MOOD_IDS = ["triumphant", "bittersweet", "somber", "mysterious"] as const;

// ---------- 條件（條件分支、選項條件、事件頁進階條件、尾聲條件） ----------

export type GameCondition =
  | { type: "switch"; id: string; value: boolean }
  | { type: "variable"; id: string; op: (typeof COMPARE_OPS)[number]; value: number }
  | { type: "selfSwitch"; key: SelfSwitchKey; value: boolean }
  | { type: "item"; itemId: string; count?: number }
  | { type: "quest"; questId: string; status: QuestStatus; step?: number }
  | { type: "chapter"; chapterId: string }
  | { type: "all"; conditions: GameCondition[] }
  | { type: "any"; conditions: GameCondition[] }
  | { type: "not"; condition: GameCondition };

export const conditionSchema: z.ZodType<GameCondition> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("switch"), id: idSchema, value: z.boolean() }),
    z.strictObject({ type: z.literal("variable"), id: idSchema, op: z.enum(COMPARE_OPS), value: z.number().int() }),
    z.strictObject({ type: z.literal("selfSwitch"), key: z.enum(SELF_SWITCHES), value: z.boolean() }),
    z.strictObject({ type: z.literal("item"), itemId: idSchema, count: z.number().int().min(1).max(999).optional() }),
    z.strictObject({
      type: z.literal("quest"),
      questId: idSchema,
      status: z.enum(QUEST_STATUSES),
      step: z.number().int().min(0).max(50).optional(),
    }),
    z.strictObject({ type: z.literal("chapter"), chapterId: idSchema }),
    z.strictObject({ type: z.literal("all"), conditions: z.array(conditionSchema).min(1).max(20) }),
    z.strictObject({ type: z.literal("any"), conditions: z.array(conditionSchema).min(1).max(20) }),
    z.strictObject({ type: z.literal("not"), condition: conditionSchema }),
  ]),
);

// ---------- 事件指令 ----------

export type ChoiceOption = { text: string; condition?: GameCondition; commands: EventCommand[] };
/** 出示物品：玩家拿出這個物品時執行 commands */
export type PresentOption = { itemId: string; commands: EventCommand[] };

export type EventCommand =
  /** 顯示文字：actorId 會帶出名字、頭像與講話聲；也可以只寫 speaker（旁白、路人） */
  | { code: "text"; text: string; actorId?: string; speaker?: string }
  /** 顯示選項：緊接在顯示文字後面時，會和文字一起顯示 */
  | { code: "choices"; options: ChoiceOption[] }
  /**
   * 出示物品：打開道具欄讓玩家挑一樣拿出來（推理對質、送禮、用鑰匙開門）。緊接在顯示文字後面時，會和文字一起顯示。
   * 拿出 options 裡的物品 → 執行那一項；拿出其他物品 → otherwise；什麼都不拿（或身上沒有東西）→ cancel
   */
  | { code: "present"; options: PresentOption[]; otherwise: EventCommand[]; cancel?: EventCommand[] }
  /** 時間經過：前進 advance 個時段（過了最後一個時段就到下一天），或直接設定成第 day 天、第 period 個時段（需要先在系統設定時段） */
  | { code: "time"; advance?: number; day?: number; period?: number }
  | { code: "if"; condition: GameCondition; then: EventCommand[]; else?: EventCommand[] }
  | { code: "switch"; ids: string[]; value: boolean }
  | { code: "selfSwitch"; key: SelfSwitchKey; value: boolean }
  | { code: "variable"; id: string; op: "set" | "add" | "sub"; value: number }
  | { code: "item"; itemId: string; delta: number }
  /** 任務日誌：開始、前進到第 step 個步驟、完成、失敗 */
  | { code: "quest"; questId: string; action: "start" | "step" | "complete" | "fail"; step?: number }
  | { code: "transfer"; mapId: string; x: number; y: number; direction?: Direction }
  | { code: "ending"; endingId: string }
  /** 進入章節：顯示章節標題卡，選單與存檔會顯示目前章節 */
  | { code: "chapter"; chapterId: string }
  | { code: "common"; id: string }
  /** 暫時消除事件：離開地圖再回來才會重新出現 */
  | { code: "erase" }
  /** 中斷事件處理 */
  | { code: "exit" }
  | { code: "label"; name: string }
  | { code: "jump"; name: string }
  | { code: "wait"; ms: number }
  | { code: "music"; mood: (typeof MUSIC_MOOD_IDS)[number] | null }
  /** 註解：不執行，給人與 AI 看的說明 */
  | { code: "comment"; text: string };

export type CommandCode = EventCommand["code"];

const labelName = z.string().min(1).max(64);

export const commandSchema: z.ZodType<EventCommand> = z.lazy(() =>
  z.discriminatedUnion("code", [
    z.strictObject({ code: z.literal("text"), text: z.string().min(1).max(2000), actorId: idSchema.optional(), speaker: z.string().max(60).optional() }),
    z.strictObject({
      code: z.literal("choices"),
      options: z
        .array(z.strictObject({ text: z.string().min(1).max(300), condition: conditionSchema.optional(), commands: z.array(commandSchema).max(400) }))
        .min(1)
        .max(8),
    }),
    z.strictObject({
      code: z.literal("present"),
      options: z.array(z.strictObject({ itemId: idSchema, commands: z.array(commandSchema).max(400) })).max(12),
      otherwise: z.array(commandSchema).max(400),
      cancel: z.array(commandSchema).max(400).optional(),
    }),
    z
      .strictObject({ code: z.literal("time"), advance: z.number().int().min(1).max(50).optional(), day: z.number().int().min(1).max(999).optional(), period: z.number().int().min(0).max(11).optional() })
      .refine((c) => c.advance !== undefined || c.day !== undefined || c.period !== undefined, "時間指令要指定 advance（經過幾個時段）或 day／period（設定成第幾天、第幾個時段）"),
    z.strictObject({ code: z.literal("if"), condition: conditionSchema, then: z.array(commandSchema).max(400), else: z.array(commandSchema).max(400).optional() }),
    z.strictObject({ code: z.literal("switch"), ids: z.array(idSchema).min(1).max(20), value: z.boolean() }),
    z.strictObject({ code: z.literal("selfSwitch"), key: z.enum(SELF_SWITCHES), value: z.boolean() }),
    z.strictObject({ code: z.literal("variable"), id: idSchema, op: z.enum(["set", "add", "sub"]), value: z.number().int().min(-999999).max(999999) }),
    z.strictObject({ code: z.literal("item"), itemId: idSchema, delta: z.number().int().min(-999).max(999).refine((n) => n !== 0, "數量不可為 0") }),
    z.strictObject({
      code: z.literal("quest"),
      questId: idSchema,
      action: z.enum(["start", "step", "complete", "fail"]),
      step: z.number().int().min(0).max(50).optional(),
    }),
    z.strictObject({ code: z.literal("transfer"), mapId: idSchema, x: coord, y: coord, direction: z.enum(DIRECTIONS).optional() }),
    z.strictObject({ code: z.literal("ending"), endingId: idSchema }),
    z.strictObject({ code: z.literal("chapter"), chapterId: idSchema }),
    z.strictObject({ code: z.literal("common"), id: idSchema }),
    z.strictObject({ code: z.literal("erase") }),
    z.strictObject({ code: z.literal("exit") }),
    z.strictObject({ code: z.literal("label"), name: labelName }),
    z.strictObject({ code: z.literal("jump"), name: labelName }),
    z.strictObject({ code: z.literal("wait"), ms: z.number().int().min(0).max(10000) }),
    z.strictObject({ code: z.literal("music"), mood: z.enum(MUSIC_MOOD_IDS).nullable() }),
    z.strictObject({ code: z.literal("comment"), text: z.string().max(2000) }),
  ]),
);

const commandList = z.array(commandSchema).max(800);

// ---------- 事件 ----------

export const pageConditionsSchema = z.strictObject({
  /** 開關（全部為 ON 才成立，RPG Maker 為 2 格） */
  switches: z.array(idSchema).max(2).optional(),
  /** 變數 ≥ 值 */
  variable: z.strictObject({ id: idSchema, min: z.number().int() }).optional(),
  selfSwitch: z.enum(SELF_SWITCHES).optional(),
  /** 持有物品 */
  itemId: idSchema.optional(),
  /** 任務狀態（本平台擴充） */
  quest: z.strictObject({ questId: idSchema, status: z.enum(QUEST_STATUSES) }).optional(),
  /** 進階條件（本平台擴充）：任意條件組合 */
  custom: conditionSchema.optional(),
});

export const eventPageSchema = z.strictObject({
  conditions: pageConditionsSchema.optional(),
  /** 沒有圖像＝透明事件（門、告示、觸發區） */
  graphic: z.strictObject({ assetId: idSchema, direction: z.enum(DIRECTIONS).optional() }).optional(),
  trigger: z.enum(["action", "touch", "autorun"]),
  priority: z.enum(["below", "same", "above"]),
  commands: commandList,
});

export const mapEventSchema = z.strictObject({
  id: idSchema,
  name: shortText,
  x: coord,
  y: coord,
  note: z.string().max(1000).optional(),
  pages: z.array(eventPageSchema).min(1).max(20),
});

export const mapSchema = z.strictObject({
  id: idSchema,
  name: shortText,
  /** 地圖樹：上層地圖 */
  parentId: idSchema.optional(),
  width: z.number().int().min(3).max(64),
  height: z.number().int().min(3).max(64),
  tileSize: z.number().int().min(16).max(64),
  tilesetId: idSchema.optional(),
  /** 語意化地形字元（見 assets.ts 的 TERRAIN） */
  terrain: z.array(z.string().max(64)).max(64),
  walkable: z.array(z.array(z.boolean()).max(64)).max(64),
  music: z.enum(MAP_MUSIC_IDS).optional(),
  /** 環境音：每一款遊戲、每一張地圖自己設計聲音，例如下雨的便利商店＝不放音樂＋雨聲 */
  ambience: z.enum(AMBIENCE_IDS).optional(),
  /**
   * 畫面模式（營造氣氛用）：standard＝RPG 比例（4:3，寬螢幕兩側留黑邊，預設）；wide＝全景（填滿寬螢幕）。
   * 例如告別式會場用 standard 顯得封閉安靜，海邊的燈籠流水用 wide 顯得開闊。
   */
  view: z.enum(["standard", "wide"]).optional(),
  events: z.array(mapEventSchema).max(200),
});

// ---------- 資料庫 ----------

export const voiceSchema = z.strictObject({
  pitch: z.enum(["low", "mid", "high"]),
  speed: z.enum(["slow", "normal", "fast"]),
  timbre: z.enum(["soft", "bright", "buzzy"]),
});

export const actorSchema = z.strictObject({
  id: idSchema,
  name: shortText,
  /** 角色設定（動機、秘密、說話風格），給人與 AI 參考，不會顯示在遊戲中 */
  profile: longText.optional(),
  spriteAssetId: idSchema.optional(),
  voice: voiceSchema.optional(),
});

export const itemSchema = z.strictObject({
  id: idSchema,
  name: shortText,
  description: longText,
  iconAssetId: idSchema.optional(),
});

export const questSchema = z.strictObject({
  id: idSchema,
  title: shortText,
  description: longText,
  /** 任務日誌的步驟（step 0 起算），玩家在選單看到目前與已完成的步驟 */
  steps: z.array(z.strictObject({ text: z.string().min(1).max(300) })).min(1).max(30),
});

export const endingSchema = z.strictObject({
  id: idSchema,
  title: shortText,
  text: z.string().min(1).max(4000),
  mood: z.enum(ENDING_MOOD_IDS).optional(),
  /** 尾聲：依玩家累積的狀態追加描述 */
  epilogues: z.array(z.strictObject({ condition: conditionSchema, text: z.string().min(1).max(300) })).max(12).optional(),
  /** 連載用的「未完待續」：下一章推出後，停在這個結局的存檔可以直接接著玩這一章（章節可以還不存在） */
  nextChapterId: idSchema.optional(),
});

/**
 * 成就：條件成立時解鎖（跨存檔記錄在玩家的裝置上）。結局會自動產生成就，不必另外寫。
 * 用來讓玩家知道「還有別的分支、別的發現」，獎勵探索與走另一條路，不是刷數量。
 */
export const achievementSchema = z.strictObject({
  id: idSchema,
  title: shortText,
  /** 解鎖後顯示的說明 */
  description: z.string().min(1).max(200),
  /** 還沒解鎖時顯示的模糊提示（例如「在告別式上，你還可以說更多」）；沒有就顯示「？？？」 */
  hint: z.string().max(120).optional(),
  /** 隱藏成就：解鎖前連標題都不顯示 */
  hidden: z.boolean().optional(),
  condition: conditionSchema,
});

export const chapterSchema = z.strictObject({
  id: idSchema,
  title: shortText,
  /** 章節標題卡下方的一句話 */
  summary: z.string().max(300).optional(),
  /** 從這一章開始測試時的位置與狀態（代表「照主線玩到這一章開頭」的典型狀態） */
  testStart: z
    .strictObject({
      mapId: idSchema,
      x: coord,
      y: coord,
      switches: z.array(idSchema).max(100).optional(),
      variables: z.record(idSchema, z.number().int()).optional(),
      items: z.record(idSchema, z.number().int().min(1)).optional(),
      quests: z.record(idSchema, z.strictObject({ status: z.enum(QUEST_STATUSES), step: z.number().int().min(0) })).optional(),
    })
    .optional(),
});

export const commonEventSchema = z.strictObject({
  id: idSchema,
  name: shortText,
  /** call：只能被「共用事件」指令呼叫；autorun：指定開關 ON 時自動執行 */
  trigger: z.enum(["call", "autorun"]),
  switchId: idSchema.optional(),
  commands: commandList,
});

export const namedIdSchema = z.strictObject({ id: idSchema, name: shortText });

export const systemSchema = z.strictObject({
  start: z.strictObject({ mapId: idSchema, x: coord, y: coord, direction: z.enum(DIRECTIONS).optional() }),
  /** 主角（資料庫角色 ID） */
  playerActorId: idSchema,
  initialItems: z.array(z.strictObject({ itemId: idSchema, count: z.number().int().min(1).max(999) })).max(50),
  /**
   * 時段與日程（選用）：例如 ["早上", "中午", "傍晚", "晚上"]。
   * 目前的時間存在內建變數 day（第幾天，從 1 開始）與 period（第幾個時段，從 0 開始），事件頁與條件分支用一般的變數條件讀取；
   * 用「時間」指令讓時間經過。畫面上會顯示「第 2 天・傍晚」。
   */
  clock: z.strictObject({ periods: z.array(z.string().min(1).max(12)).min(2).max(12) }).optional(),
});

export const assetSrcSchema = z
  .string()
  .regex(/^\/assets\/[A-Za-z0-9_\-/]+\.(svg|png|webp|mp3|ogg)$/, "素材路徑必須是 /assets/ 底下的站內檔案");

export const assetSchema = z.strictObject({
  id: idSchema,
  kind: z.enum(["tileset", "character", "portrait", "icon", "background", "audio"]),
  src: assetSrcSchema,
  frame: z.number().int().min(0).max(4096).optional(),
  frameSize: z.number().int().min(8).max(128).optional(),
  license: shortText,
  attribution: z.string().max(500).optional(),
  sourceUrl: z.string().max(500).optional(),
  author: z.string().max(200).optional(),
});

export const gameProjectSchema = z.strictObject({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: idSchema,
  title: shortText,
  description: longText,
  genre: z.enum(["fantasy", "modern", "sci-fi", "mystery"]),
  /** 開場文字（新遊戲時以系統訊息顯示，空行分段） */
  intro: z.string().max(4000).optional(),
  cover: z
    .strictObject({
      mapId: idSchema.optional(),
      characterAssetIds: z.array(idSchema).max(3).optional(),
      tagline: z.string().max(60).optional(),
      /** 標題畫面的音樂與環境音（沒設定就用封面地圖的） */
      music: z.enum(MAP_MUSIC_IDS).optional(),
      ambience: z.enum(AMBIENCE_IDS).optional(),
    })
    .optional(),
  /** 推出方式：連載中（一章一章推出，玩家更新後存檔接著玩）或已完結 */
  release: z.strictObject({ status: z.enum(["ongoing", "complete"]), plannedChapters: z.number().int().min(1).max(20).optional() }).optional(),
  system: systemSchema,
  actors: z.array(actorSchema).min(1).max(100),
  items: z.array(itemSchema).max(200),
  quests: z.array(questSchema).max(60),
  endings: z.array(endingSchema).min(1).max(10),
  chapters: z.array(chapterSchema).max(20),
  achievements: z.array(achievementSchema).max(60).optional(),
  switches: z.array(namedIdSchema).max(500),
  variables: z.array(namedIdSchema).max(200),
  commonEvents: z.array(commonEventSchema).max(100),
  maps: z.array(mapSchema).min(1).max(40),
  assetManifest: z.strictObject({ assets: z.array(assetSchema).max(300) }),
});

export type GameProject = z.infer<typeof gameProjectSchema>;
export type MapDefinition = z.infer<typeof mapSchema>;
export type AchievementDefinition = z.infer<typeof achievementSchema>;
export type MapEvent = z.infer<typeof mapEventSchema>;
export type EventPage = z.infer<typeof eventPageSchema>;
export type PageConditions = z.infer<typeof pageConditionsSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type ItemDefinition = z.infer<typeof itemSchema>;
export type QuestDefinition = z.infer<typeof questSchema>;
export type EndingDefinition = z.infer<typeof endingSchema>;
export type ChapterDefinition = z.infer<typeof chapterSchema>;
export type CommonEvent = z.infer<typeof commonEventSchema>;
export type AssetDefinition = z.infer<typeof assetSchema>;
export type Voice = z.infer<typeof voiceSchema>;

export const GENRE_LABELS: Record<GameProject["genre"], string> = {
  fantasy: "奇幻",
  modern: "現代",
  "sci-fi": "科幻",
  mystery: "懸疑",
};
