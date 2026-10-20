import { z } from "zod";
import { findCatalogAsset, manifestEntry, TERRAIN, walkableFromTerrain } from "@/game/assets";
import {
  conditionSchema,
  dialogueNodeSchema,
  endingSchema,
  idSchema,
  itemSchema,
  npcSchema,
  questSchema,
  type GameProject,
  type SceneDefinition,
} from "@/game/schema";
import { validateProject, type ValidationReport } from "@/game/validate";

/**
 * Studio 操作 API：Studio 的每一個編輯動作都是一筆「操作」。
 * - 人在 Studio 裡點按 → 產生操作 → applyOps
 * - AI 透過本機 AI bridge（POST /api/studio/ops）或 CLI（npm run studio）送出同樣的操作
 * 每筆操作都會先檢查格式，套用後回傳整份專案的驗證報告；衍生資料（walkable、npcIds、素材清單）自動維護。
 */

const pos = z.strictObject({ x: z.number().int().min(0).max(255), y: z.number().int().min(0).max(255) });

const interactableSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1).max(200),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  dialogueNodeId: idSchema,
  dialogueVariants: z.array(z.strictObject({ condition: conditionSchema, dialogueNodeId: idSchema })).optional(),
});

export const opSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("project.update"),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    intro: z.string().max(4000).optional(),
    genre: z.enum(["fantasy", "modern", "sci-fi", "mystery"]).optional(),
    cover: z.any().optional(),
  }),
  z.strictObject({
    op: z.literal("player.update"),
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    spriteAssetId: idSchema.optional(),
    start: z.strictObject({ sceneId: idSchema, x: z.number().int().min(0), y: z.number().int().min(0) }).optional(),
  }),
  z.strictObject({
    op: z.literal("scene.add"),
    id: idSchema,
    name: z.string().min(1).max(200),
    width: z.number().int().min(3).max(64),
    height: z.number().int().min(3).max(64),
    fill: z.string().length(1).optional(),
    music: z.string().optional(),
  }),
  z.strictObject({
    op: z.literal("scene.update"),
    id: idSchema,
    name: z.string().min(1).max(200).optional(),
    music: z.enum(["peaceful", "lively", "adventure", "mysterious", "tense", "melancholy"]).optional(),
  }),
  z.strictObject({ op: z.literal("scene.resize"), id: idSchema, width: z.number().int().min(3).max(64), height: z.number().int().min(3).max(64), fill: z.string().length(1).optional() }),
  z.strictObject({ op: z.literal("scene.remove"), id: idSchema }),
  z.strictObject({
    op: z.literal("scene.paint"),
    sceneId: idSchema,
    cells: z.array(pos.extend({ ch: z.string().length(1) })).min(1).max(4096),
  }),
  z.strictObject({ op: z.literal("scene.fill"), sceneId: idSchema, x: z.number().int(), y: z.number().int(), ch: z.string().length(1) }),
  z.strictObject({ op: z.literal("npc.upsert"), npc: npcSchema }),
  z.strictObject({ op: z.literal("npc.remove"), id: idSchema }),
  z.strictObject({ op: z.literal("interactable.upsert"), sceneId: idSchema, object: interactableSchema }),
  z.strictObject({ op: z.literal("interactable.remove"), sceneId: idSchema, id: idSchema }),
  z.strictObject({
    op: z.literal("pickup.upsert"),
    sceneId: idSchema,
    pickup: z.strictObject({ id: idSchema, itemId: idSchema, x: z.number().int(), y: z.number().int(), count: z.number().int().min(1).optional(), condition: conditionSchema.optional() }),
  }),
  z.strictObject({ op: z.literal("pickup.remove"), sceneId: idSchema, id: idSchema }),
  z.strictObject({
    op: z.literal("exit.upsert"),
    sceneId: idSchema,
    exit: z.strictObject({ x: z.number().int(), y: z.number().int(), targetSceneId: idSchema, targetX: z.number().int(), targetY: z.number().int(), label: z.string().max(60).optional() }),
  }),
  z.strictObject({ op: z.literal("exit.remove"), sceneId: idSchema, x: z.number().int(), y: z.number().int() }),
  z.strictObject({
    op: z.literal("location.upsert"),
    sceneId: idSchema,
    location: z.strictObject({ id: idSchema, name: z.string().min(1), x: z.number().int(), y: z.number().int(), width: z.number().int().min(1).optional(), height: z.number().int().min(1).optional() }),
  }),
  z.strictObject({ op: z.literal("location.remove"), sceneId: idSchema, id: idSchema }),
  z.strictObject({ op: z.literal("dialogue.upsert"), node: dialogueNodeSchema }),
  z.strictObject({ op: z.literal("dialogue.remove"), id: idSchema }),
  z.strictObject({ op: z.literal("quest.upsert"), quest: questSchema }),
  z.strictObject({ op: z.literal("quest.remove"), id: idSchema }),
  z.strictObject({ op: z.literal("item.upsert"), item: itemSchema }),
  z.strictObject({ op: z.literal("item.remove"), id: idSchema }),
  z.strictObject({ op: z.literal("ending.upsert"), ending: endingSchema }),
  z.strictObject({ op: z.literal("ending.remove"), id: idSchema }),
]);
export type StudioOp = z.infer<typeof opSchema>;

export type OpResult = { ok: boolean; message: string };
export type ApplyResult = { project: GameProject; results: OpResult[]; report: ValidationReport };

/** 操作的人類可讀描述（顯示在 Studio 的歷史紀錄） */
export function describeOp(op: StudioOp): string {
  switch (op.op) {
    case "project.update":
      return "修改專案資訊";
    case "player.update":
      return "修改玩家設定";
    case "scene.add":
      return `新增地圖「${op.name}」`;
    case "scene.update":
      return "修改地圖屬性";
    case "scene.resize":
      return `調整地圖大小為 ${op.width}×${op.height}`;
    case "scene.remove":
      return `刪除地圖 ${op.id}`;
    case "scene.paint":
      return `繪製地形 ${op.cells.length} 格`;
    case "scene.fill":
      return `油漆桶填滿「${TERRAIN[op.ch]?.name ?? op.ch}」`;
    case "npc.upsert":
      return `設定 NPC「${op.npc.name}」`;
    case "npc.remove":
      return `刪除 NPC ${op.id}`;
    case "interactable.upsert":
      return `設定調查點「${op.object.name}」`;
    case "interactable.remove":
      return `刪除調查點 ${op.id}`;
    case "pickup.upsert":
      return `設定撿取物 ${op.pickup.id}`;
    case "pickup.remove":
      return `刪除撿取物 ${op.id}`;
    case "exit.upsert":
      return `設定出口 (${op.exit.x},${op.exit.y})`;
    case "exit.remove":
      return `刪除出口 (${op.x},${op.y})`;
    case "location.upsert":
      return `設定地點「${op.location.name}」`;
    case "location.remove":
      return `刪除地點 ${op.id}`;
    case "dialogue.upsert":
      return `設定對話 ${op.node.id}`;
    case "dialogue.remove":
      return `刪除對話 ${op.id}`;
    case "quest.upsert":
      return `設定任務「${op.quest.title}」`;
    case "quest.remove":
      return `刪除任務 ${op.id}`;
    case "item.upsert":
      return `設定物品「${op.item.name}」`;
    case "item.remove":
      return `刪除物品 ${op.id}`;
    case "ending.upsert":
      return `設定結局「${op.ending.title}」`;
    case "ending.remove":
      return `刪除結局 ${op.id}`;
  }
}

function sceneOf(p: GameProject, id: string): SceneDefinition {
  const scene = p.scenes.find((s) => s.id === id);
  if (!scene) throw new Error(`找不到地圖「${id}」`);
  return scene;
}

function upsert<T extends { id: string }>(list: T[], value: T) {
  const i = list.findIndex((x) => x.id === value.id);
  if (i >= 0) list[i] = value;
  else list.push(value);
}

function ensureTerrain(scene: SceneDefinition) {
  if (!scene.terrain) scene.terrain = scene.walkable.map((row) => row.map((w) => (w ? "." : "T")).join(""));
  return scene.terrain;
}

function setCell(scene: SceneDefinition, x: number, y: number, ch: string) {
  if (!TERRAIN[ch]) throw new Error(`未知的地形字元「${ch}」`);
  if (x < 0 || y < 0 || x >= scene.width || y >= scene.height) return;
  const rows = ensureTerrain(scene);
  const row = [...rows[y]];
  row[x] = ch;
  rows[y] = row.join("");
}

/** 維護衍生資料：walkable、scene.npcIds、素材清單（只加入內建素材庫的素材） */
function normalize(p: GameProject) {
  for (const scene of p.scenes) {
    if (scene.terrain) {
      scene.height = scene.terrain.length;
      scene.width = Math.max(...scene.terrain.map((r) => [...r].length));
      scene.walkable = walkableFromTerrain(scene.terrain);
    }
    scene.npcIds = p.npcs.filter((n) => n.sceneId === scene.id).map((n) => n.id);
  }
  const used = new Set<string>();
  p.scenes.forEach((s) => s.tilesetId && used.add(s.tilesetId));
  if (p.player.spriteAssetId) used.add(p.player.spriteAssetId);
  p.npcs.forEach((n) => n.spriteAssetId && used.add(n.spriteAssetId));
  p.items.forEach((i) => i.iconAssetId && used.add(i.iconAssetId));
  p.cover?.characterAssetIds?.forEach((id) => used.add(id));
  for (const id of used) {
    if (findCatalogAsset(id) && !p.assetManifest.assets.some((a) => a.id === id)) p.assetManifest.assets.push(manifestEntry(id));
  }
}

function applyOne(p: GameProject, op: StudioOp) {
  switch (op.op) {
    case "project.update": {
      const { op: _op, ...fields } = op;
      void _op;
      Object.assign(p, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
      return;
    }
    case "player.update":
      if (op.name !== undefined) p.player.name = op.name;
      if (op.description !== undefined) p.player.description = op.description;
      if (op.spriteAssetId !== undefined) p.player.spriteAssetId = op.spriteAssetId;
      if (op.start) {
        p.player.startPosition = op.start;
        p.startSceneId = op.start.sceneId;
      }
      return;
    case "scene.add": {
      if (p.scenes.some((s) => s.id === op.id)) throw new Error(`地圖 ID「${op.id}」已存在`);
      const fill = op.fill ?? ".";
      const terrain = Array.from({ length: op.height }, (_, y) =>
        Array.from({ length: op.width }, (_, x) => (x === 0 || y === 0 || x === op.width - 1 || y === op.height - 1 ? "T" : fill)).join(""),
      );
      p.scenes.push({
        id: op.id,
        name: op.name,
        width: op.width,
        height: op.height,
        tileSize: 40,
        tilesetId: "tileset_tiny_town",
        terrain,
        walkable: walkableFromTerrain(terrain),
        exits: [],
        npcIds: [],
        locations: [],
        pickups: [],
        interactables: [],
        ...(op.music ? { music: op.music as SceneDefinition["music"] } : {}),
      });
      return;
    }
    case "scene.update": {
      const s = sceneOf(p, op.id);
      if (op.name !== undefined) s.name = op.name;
      if (op.music !== undefined) s.music = op.music;
      return;
    }
    case "scene.resize": {
      const s = sceneOf(p, op.id);
      const rows = ensureTerrain(s);
      const fill = op.fill ?? ".";
      s.terrain = Array.from({ length: op.height }, (_, y) => Array.from({ length: op.width }, (_, x) => [...(rows[y] ?? "")][x] ?? fill).join(""));
      return;
    }
    case "scene.remove":
      if (p.scenes.length <= 1) throw new Error("至少要保留一張地圖");
      p.scenes = p.scenes.filter((s) => s.id !== op.id);
      p.npcs = p.npcs.filter((n) => n.sceneId !== op.id);
      p.scenes.forEach((s) => (s.exits = s.exits.filter((e) => e.targetSceneId !== op.id)));
      return;
    case "scene.paint": {
      const s = sceneOf(p, op.sceneId);
      op.cells.forEach((c) => setCell(s, c.x, c.y, c.ch));
      return;
    }
    case "scene.fill": {
      const s = sceneOf(p, op.sceneId);
      const rows = ensureTerrain(s);
      const target = [...rows[op.y] ?? ""][op.x];
      if (target === undefined || target === op.ch) return;
      const grid = rows.map((r) => [...r]);
      const stack: Array<[number, number]> = [[op.x, op.y]];
      while (stack.length) {
        const [x, y] = stack.pop()!;
        if (grid[y]?.[x] !== target) continue;
        grid[y][x] = op.ch;
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      if (!TERRAIN[op.ch]) throw new Error(`未知的地形字元「${op.ch}」`);
      s.terrain = grid.map((r) => r.join(""));
      return;
    }
    case "npc.upsert":
      sceneOf(p, op.npc.sceneId);
      upsert(p.npcs, op.npc);
      return;
    case "npc.remove":
      p.npcs = p.npcs.filter((n) => n.id !== op.id);
      return;
    case "interactable.upsert": {
      const s = sceneOf(p, op.sceneId);
      p.scenes.forEach((sc) => sc.id !== s.id && (sc.interactables = sc.interactables?.filter((o) => o.id !== op.object.id)));
      upsert((s.interactables ??= []), op.object as NonNullable<SceneDefinition["interactables"]>[number]);
      return;
    }
    case "interactable.remove": {
      const s = sceneOf(p, op.sceneId);
      s.interactables = (s.interactables ?? []).filter((o) => o.id !== op.id);
      return;
    }
    case "pickup.upsert":
      upsert((sceneOf(p, op.sceneId).pickups ??= []), op.pickup as NonNullable<SceneDefinition["pickups"]>[number]);
      return;
    case "pickup.remove": {
      const s = sceneOf(p, op.sceneId);
      s.pickups = (s.pickups ?? []).filter((x) => x.id !== op.id);
      return;
    }
    case "exit.upsert": {
      const s = sceneOf(p, op.sceneId);
      s.exits = [...s.exits.filter((e) => !(e.x === op.exit.x && e.y === op.exit.y)), op.exit];
      return;
    }
    case "exit.remove": {
      const s = sceneOf(p, op.sceneId);
      s.exits = s.exits.filter((e) => !(e.x === op.x && e.y === op.y));
      return;
    }
    case "location.upsert":
      upsert((sceneOf(p, op.sceneId).locations ??= []), op.location);
      return;
    case "location.remove": {
      const s = sceneOf(p, op.sceneId);
      s.locations = (s.locations ?? []).filter((x) => x.id !== op.id);
      return;
    }
    case "dialogue.upsert":
      upsert(p.dialogues, op.node);
      return;
    case "dialogue.remove":
      p.dialogues = p.dialogues.filter((d) => d.id !== op.id);
      return;
    case "quest.upsert":
      upsert(p.quests, op.quest);
      return;
    case "quest.remove":
      p.quests = p.quests.filter((q) => q.id !== op.id);
      return;
    case "item.upsert":
      upsert(p.items, op.item);
      return;
    case "item.remove":
      p.items = p.items.filter((i) => i.id !== op.id);
      return;
    case "ending.upsert":
      upsert(p.endings, op.ending);
      return;
    case "ending.remove":
      p.endings = p.endings.filter((e) => e.id !== op.id);
      return;
  }
}

/**
 * 依序套用操作。單筆操作失敗不會影響其他操作（結果逐筆回報）；
 * 套用後重新驗證整份專案。中途狀態允許暫時不合法（例如先放 NPC 再補對話），由驗證報告提示。
 */
export function applyOps(project: GameProject, rawOps: unknown[]): ApplyResult {
  const p = structuredClone(project);
  const results: OpResult[] = [];
  for (const raw of rawOps) {
    const parsed = opSchema.safeParse(raw);
    if (!parsed.success) {
      results.push({ ok: false, message: `操作格式錯誤：${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}` });
      continue;
    }
    const snapshot = structuredClone(p);
    try {
      applyOne(p, parsed.data);
      normalize(p);
      results.push({ ok: true, message: describeOp(parsed.data) });
    } catch (e) {
      Object.assign(p, snapshot);
      results.push({ ok: false, message: `${describeOp(parsed.data)}失敗：${(e as Error).message}` });
    }
  }
  const v = validateProject(p);
  return { project: p, results, report: { isValid: v.isValid, errors: v.errors, warnings: v.warnings } };
}
