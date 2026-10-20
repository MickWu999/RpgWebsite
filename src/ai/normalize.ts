import {
  ASSET_CATALOG,
  DEFAULT_ITEM_ICON,
  DEFAULT_NPC_SPRITE,
  DEFAULT_PLAYER_SPRITE,
  findCatalogAsset,
  manifestEntry,
  walkableFromTerrain,
} from "@/game/assets";
import { SCHEMA_VERSION } from "@/game/schema";

/**
 * 把 AI 輸出補成完整 GameProject：填入 schemaVersion／id、由 terrain 推導 walkable、
 * 補 npcIds、替換不存在的素材 ID，並由素材庫產生 assetManifest（含真實授權紀錄）。
 * 只做機械性補完，不改動故事內容；結果仍需經過 validateProject。
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const TILESET_ID = ASSET_CATALOG.find((a) => a.kind === "tileset")!.id;

export function normalizeAiProject(raw: unknown, projectId: string): { project: unknown; notes: string[] } {
  const notes: string[] = [];
  if (!isObj(raw)) return { project: raw, notes };
  const p: Obj = structuredClone(raw);
  p.schemaVersion = SCHEMA_VERSION;
  p.id = projectId;

  const npcs = Array.isArray(p.npcs) ? (p.npcs as Obj[]).filter(isObj) : [];
  const scenes = Array.isArray(p.scenes) ? (p.scenes as Obj[]).filter(isObj) : [];
  for (const scene of scenes) {
    if (Array.isArray(scene.terrain) && scene.terrain.every((r) => typeof r === "string")) {
      const terrain = scene.terrain as string[];
      scene.height = terrain.length;
      scene.width = Math.max(...terrain.map((r) => [...r].length));
      scene.walkable = walkableFromTerrain(terrain);
    }
    scene.tileSize = typeof scene.tileSize === "number" ? scene.tileSize : 40;
    scene.tilesetId = TILESET_ID;
    scene.exits = Array.isArray(scene.exits) ? scene.exits : [];
    const ids = npcs.filter((n) => n.sceneId === scene.id).map((n) => n.id);
    const listed = Array.isArray(scene.npcIds) ? (scene.npcIds as unknown[]) : [];
    if (ids.some((id) => !listed.includes(id))) notes.push(`已補上場景「${String(scene.id)}」的 npcIds`);
    scene.npcIds = [...new Set([...listed.filter((id) => ids.includes(id)), ...ids])];
  }

  const used = new Set<string>([TILESET_ID]);
  const pick = (holder: Obj, key: string, kind: "character" | "icon", fallback: string, label: string) => {
    const id = holder[key];
    const asset = typeof id === "string" ? findCatalogAsset(id) : undefined;
    if (!asset || asset.kind !== kind) {
      if (id !== undefined) notes.push(`${label} 使用了不存在的素材「${String(id)}」，已改為預設素材`);
      holder[key] = fallback;
    }
    used.add(holder[key] as string);
  };
  if (isObj(p.player)) pick(p.player, "spriteAssetId", "character", DEFAULT_PLAYER_SPRITE, "玩家");
  npcs.forEach((n) => pick(n, "spriteAssetId", "character", DEFAULT_NPC_SPRITE, `NPC「${String(n.name)}」`));
  const items = Array.isArray(p.items) ? (p.items as Obj[]).filter(isObj) : [];
  items.forEach((i) => pick(i, "iconAssetId", "icon", DEFAULT_ITEM_ICON, `物品「${String(i.name)}」`));

  p.assetManifest = { assets: [...used].map(manifestEntry) };
  return { project: p, notes };
}
