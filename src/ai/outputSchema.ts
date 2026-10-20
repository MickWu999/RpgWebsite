import { z } from "zod";
import { gameProjectSchema, sceneSchema } from "@/game/schema";

/**
 * AI 輸出專用 schema：AI 只負責故事、角色、地圖配置、任務與對話。
 * - `walkable` 由 terrain 推導，`assetManifest` 由內建素材庫產生（AI 不得自行宣告素材或授權）。
 * - `schemaVersion`、`id` 由程式填入。
 * 正規化之後仍會用完整的 gameProjectSchema 與邏輯驗證再檢查一次。
 */
export const aiSceneSchema = sceneSchema
  .omit({ walkable: true, colors: true, backgroundAssetId: true, tilesetId: true })
  .extend({ terrain: z.array(z.string().max(64)).min(3).max(64) });

export const aiProjectSchema = gameProjectSchema
  .omit({ schemaVersion: true, id: true, assetManifest: true })
  .extend({ scenes: z.array(aiSceneSchema).min(1).max(5) });

export type AiProjectOutput = z.infer<typeof aiProjectSchema>;

/** 轉成 Claude Code CLI 的 --json-schema 可接受的格式（draft-7，不帶 $schema 宣告） */
export function toCliJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export function aiProjectJsonSchema(): Record<string, unknown> {
  return toCliJsonSchema(aiProjectSchema);
}
