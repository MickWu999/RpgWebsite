import { z } from "zod";

/**
 * GameProject 正式 schema（SPEC §6 的實作版）。
 *
 * 相對於 SPEC 概念 schema 的擴充（皆為選填或必要的補完）：
 * - `dialogues`：SPEC 定義了 DialogueNode 但 GameProject 沒有收納它的集合，這裡補上。
 * - `scene.locations`：reach_location 任務目標需要可參照的「地點」。
 * - `scene.pickups`：讓道具能放在地圖上撿取（collect_item 目標）。
 * - `scene.terrain`：語意化地形字元（見 assets.ts 的 TERRAIN），renderer 依素材庫對應圖塊。
 * - `scene.colors`：沒有 terrain 時的色塊 placeholder 顏色。
 * - `player.spriteAssetId`、`asset.frame/frameSize`：角色圖與 spritesheet 圖塊。
 * - `npc.voice`：對話逐字顯示時的合成語音（由 AI 依角色個性設計）；`ending.mood`：結局音樂的情緒；
 *   `scene.music`：場景背景音樂的情緒標籤（對應素材庫曲目）。
 * - `npc.dialogueVariants`：依條件切換 NPC 的起始對話節點。
 * - condition 新增 `quest_active`、`all`、`any`、`not`；effect 新增 `remove_item`。
 * 不在 schema 中的 effect / condition 一律拒絕（strict object + discriminated union）。
 */

export const SCHEMA_VERSION = "1.0" as const;

export const idSchema = z
  .string()
  .min(1, "ID 不可為空")
  .max(64, "ID 長度不可超過 64")
  .regex(/^[A-Za-z0-9_-]+$/, "ID 只能包含英數字、底線與連字號");

const shortText = z.string().min(1).max(200);
const longText = z.string().max(4000);
const flagValue = z.union([z.string().max(200), z.number(), z.boolean()]);
const coord = z.number().int().min(0).max(255);

export type GameCondition =
  | { type: "quest_completed"; questId: string }
  | { type: "quest_active"; questId: string }
  | { type: "has_item"; itemId: string; count?: number }
  | { type: "flag_equals"; flag: string; value: string | number | boolean }
  | { type: "stat_at_least"; stat: "hp" | "level" | "xp"; value: number }
  | { type: "all"; conditions: GameCondition[] }
  | { type: "any"; conditions: GameCondition[] }
  | { type: "not"; condition: GameCondition };

export const conditionSchema: z.ZodType<GameCondition> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("quest_completed"), questId: idSchema }),
    z.strictObject({ type: z.literal("quest_active"), questId: idSchema }),
    z.strictObject({
      type: z.literal("has_item"),
      itemId: idSchema,
      count: z.number().int().min(1).max(999).optional(),
    }),
    z.strictObject({ type: z.literal("flag_equals"), flag: idSchema, value: flagValue }),
    z.strictObject({
      type: z.literal("stat_at_least"),
      stat: z.enum(["hp", "level", "xp"]),
      value: z.number().int().min(0),
    }),
    z.strictObject({ type: z.literal("all"), conditions: z.array(conditionSchema).min(1).max(20) }),
    z.strictObject({ type: z.literal("any"), conditions: z.array(conditionSchema).min(1).max(20) }),
    z.strictObject({ type: z.literal("not"), condition: conditionSchema }),
  ]),
);

export const effectSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("give_item"),
    itemId: idSchema,
    count: z.number().int().min(1).max(999).optional(),
  }),
  z.strictObject({
    type: z.literal("remove_item"),
    itemId: idSchema,
    count: z.number().int().min(1).max(999).optional(),
  }),
  z.strictObject({ type: z.literal("add_xp"), amount: z.number().int().min(-10000).max(10000) }),
  z.strictObject({ type: z.literal("set_flag"), flag: idSchema, value: flagValue }),
  z.strictObject({ type: z.literal("complete_quest"), questId: idSchema }),
]);
export type GameEffect = z.infer<typeof effectSchema>;

const positionSchema = z.strictObject({ x: coord, y: coord });

export const playerSchema = z.strictObject({
  name: shortText,
  description: longText.optional(),
  spriteAssetId: idSchema.optional(),
  startPosition: z.strictObject({ sceneId: idSchema, x: coord, y: coord }),
  baseStats: z.strictObject({
    hp: z.number().int().min(1).max(9999),
    level: z.number().int().min(1).max(99),
    xp: z.number().int().min(0),
  }),
  inventoryItemIds: z.array(idSchema).max(50),
});

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "顏色需為 #RRGGBB");

export const sceneSchema = z.strictObject({
  id: idSchema,
  name: shortText,
  width: z.number().int().min(3).max(64),
  height: z.number().int().min(3).max(64),
  tileSize: z.number().int().min(16).max(64),
  backgroundAssetId: idSchema.optional(),
  tilesetId: idSchema.optional(),
  colors: z.strictObject({ floor: hexColor, wall: hexColor }).optional(),
  terrain: z.array(z.string().max(64)).max(64).optional(),
  music: z.enum(["peaceful", "lively", "adventure", "mysterious", "tense", "melancholy"]).optional(),
  walkable: z.array(z.array(z.boolean()).max(64)).max(64),
  exits: z
    .array(
      z.strictObject({
        x: coord,
        y: coord,
        targetSceneId: idSchema,
        targetX: coord,
        targetY: coord,
        label: z.string().max(60).optional(),
      }),
    )
    .max(20),
  npcIds: z.array(idSchema).max(30),
  locations: z
    .array(
      z.strictObject({
        id: idSchema,
        name: shortText,
        x: coord,
        y: coord,
        width: z.number().int().min(1).max(64).optional(),
        height: z.number().int().min(1).max(64).optional(),
      }),
    )
    .max(30)
    .optional(),
  pickups: z
    .array(
      z.strictObject({
        id: idSchema,
        itemId: idSchema,
        x: coord,
        y: coord,
        count: z.number().int().min(1).max(99).optional(),
        condition: conditionSchema.optional(),
      }),
    )
    .max(30)
    .optional(),
});

export const npcSchema = z.strictObject({
  id: idSchema,
  name: shortText,
  description: longText,
  sceneId: idSchema,
  position: positionSchema,
  spriteAssetId: idSchema.optional(),
  dialogueNodeId: idSchema,
  dialogueVariants: z
    .array(z.strictObject({ condition: conditionSchema, dialogueNodeId: idSchema }))
    .max(20)
    .optional(),
  questIds: z.array(idSchema).max(20).optional(),
  voice: z
    .strictObject({
      pitch: z.enum(["low", "mid", "high"]),
      speed: z.enum(["slow", "normal", "fast"]),
      timbre: z.enum(["soft", "bright", "buzzy"]),
    })
    .optional(),
});

export const dialogueChoiceSchema = z.strictObject({
  id: idSchema,
  text: z.string().min(1).max(300),
  nextNodeId: idSchema.optional(),
  effects: z.array(effectSchema).max(20).optional(),
  condition: conditionSchema.optional(),
});

export const dialogueNodeSchema = z.strictObject({
  id: idSchema,
  speaker: shortText,
  text: z.string().min(1).max(2000),
  choices: z.array(dialogueChoiceSchema).max(8).optional(),
});

export const objectiveSchema = z.strictObject({
  id: idSchema,
  type: z.enum(["talk_to_npc", "collect_item", "reach_location", "make_choice"]),
  targetId: idSchema,
  description: z.string().min(1).max(300),
  requiredCount: z.number().int().min(1).max(999).optional(),
});

export const questSchema = z.strictObject({
  id: idSchema,
  title: shortText,
  description: longText,
  startCondition: conditionSchema.optional(),
  objectives: z.array(objectiveSchema).min(1).max(20),
  rewards: z.array(effectSchema).max(20).optional(),
});

export const itemSchema = z.strictObject({
  id: idSchema,
  name: shortText,
  description: longText,
  iconAssetId: idSchema.optional(),
  stackable: z.boolean().optional(),
});

export const endingSchema = z.strictObject({
  id: idSchema,
  title: shortText,
  text: z.string().min(1).max(4000),
  condition: conditionSchema,
  mood: z.enum(["triumphant", "bittersweet", "somber", "mysterious"]).optional(),
});

/** 素材只允許站內路徑（SPEC §12 對外部 URL 採 allowlist） */
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
  intro: z.string().max(4000).optional(),
  startSceneId: idSchema,
  player: playerSchema,
  scenes: z.array(sceneSchema).min(1).max(10),
  npcs: z.array(npcSchema).max(50),
  dialogues: z.array(dialogueNodeSchema).max(300),
  quests: z.array(questSchema).max(30),
  items: z.array(itemSchema).max(100),
  endings: z.array(endingSchema).min(1).max(10),
  assetManifest: z.strictObject({ assets: z.array(assetSchema).max(200) }),
});

export type GameProject = z.infer<typeof gameProjectSchema>;
export type SceneDefinition = z.infer<typeof sceneSchema>;
export type NPCDefinition = z.infer<typeof npcSchema>;
export type DialogueNode = z.infer<typeof dialogueNodeSchema>;
export type DialogueChoice = z.infer<typeof dialogueChoiceSchema>;
export type QuestDefinition = z.infer<typeof questSchema>;
export type QuestObjective = z.infer<typeof objectiveSchema>;
export type ItemDefinition = z.infer<typeof itemSchema>;
export type EndingDefinition = z.infer<typeof endingSchema>;
export type AssetDefinition = z.infer<typeof assetSchema>;

export const GENRE_LABELS: Record<GameProject["genre"], string> = {
  fantasy: "奇幻",
  modern: "現代",
  "sci-fi": "科幻",
  mystery: "懸疑",
};
