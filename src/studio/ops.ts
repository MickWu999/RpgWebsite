import { z } from "zod";
import { findCatalogAsset, manifestEntry, SHEET_TILESET_ID, TERRAIN, terrainSheet, terrainUnder, walkableFromTerrain } from "@/game/assets";
import { allConditions, walkCondition, walkProject } from "@/game/commands";
import {
  actorSchema,
  chapterSchema,
  commonEventSchema,
  DIRECTIONS,
  achievementSchema,
  endingSchema,
  idSchema,
  itemSchema,
  mapEventSchema,
  MUSIC_MOOD_IDS,
  questSchema,
  type GameProject,
  type MapDefinition,
} from "@/game/schema";
import { validateProject, type ValidationReport } from "@/game/validate";

/**
 * Studio 操作 API：Studio 的每一個編輯動作都是一筆「操作」。
 * - 人在 Studio 裡點按 → 產生操作 → applyOps
 * - AI（VS Code 的 Claude Code）透過 `npm run game -- remote apply` 送出同樣的操作
 * 每筆操作都會先檢查格式；衍生資料自動維護：walkable、素材清單、被引用但尚未定義的開關／變數（以 ID 當名稱）。
 */

const coord = z.number().int().min(0).max(255);
const terrainChar = z.string().length(1);
const named = z.strictObject({ id: idSchema, name: z.string().min(1).max(200) });

export const opSchema = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("project.update"),
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).optional(),
    intro: z.string().max(4000).optional(),
    genre: z.enum(["fantasy", "modern", "sci-fi", "mystery"]).optional(),
    cover: z
      .strictObject({ mapId: idSchema.optional(), characterAssetIds: z.array(idSchema).max(3).optional(), tagline: z.string().max(60).optional() })
      .optional(),
    release: z.strictObject({ status: z.enum(["ongoing", "complete"]), plannedChapters: z.number().int().min(1).max(20).optional() }).optional(),
  }),
  z.strictObject({
    op: z.literal("system.update"),
    start: z.strictObject({ mapId: idSchema, x: coord, y: coord, direction: z.enum(DIRECTIONS).optional() }).optional(),
    playerActorId: idSchema.optional(),
    initialItems: z.array(z.strictObject({ itemId: idSchema, count: z.number().int().min(1).max(999) })).max(50).optional(),
    /** 時段與日程：{periods: ["早上", "中午", "傍晚", "晚上"]}；null 關閉 */
    clock: z.strictObject({ periods: z.array(z.string().min(1).max(12)).min(2).max(12) }).nullable().optional(),
  }),
  z.strictObject({
    op: z.literal("map.add"),
    id: idSchema,
    name: z.string().min(1).max(200),
    width: z.number().int().min(3).max(64),
    height: z.number().int().min(3).max(64),
    fill: terrainChar.optional(),
    music: z.enum(MUSIC_MOOD_IDS).optional(),
    view: z.enum(["standard", "wide"]).optional(),
    parentId: idSchema.optional(),
  }),
  z.strictObject({
    op: z.literal("map.update"),
    id: idSchema,
    name: z.string().min(1).max(200).optional(),
    music: z.enum(MUSIC_MOOD_IDS).nullable().optional(),
    /** 畫面模式：standard＝RPG 比例（兩側黑邊）；wide＝全景；null＝回到預設 */
    view: z.enum(["standard", "wide"]).nullable().optional(),
    parentId: idSchema.nullable().optional(),
  }),
  z.strictObject({ op: z.literal("map.resize"), id: idSchema, width: z.number().int().min(3).max(64), height: z.number().int().min(3).max(64), fill: terrainChar.optional() }),
  z.strictObject({ op: z.literal("map.remove"), id: idSchema }),
  /** 整張地圖的地形（每列一個字串），最適合 AI 一次畫好 */
  z.strictObject({ op: z.literal("map.terrain"), mapId: idSchema, rows: z.array(z.string().min(3).max(64)).min(3).max(64) }),
  z.strictObject({ op: z.literal("map.paint"), mapId: idSchema, cells: z.array(z.strictObject({ x: coord, y: coord, ch: terrainChar })).min(1).max(4096) }),
  z.strictObject({ op: z.literal("map.fill"), mapId: idSchema, x: coord, y: coord, ch: terrainChar }),
  z.strictObject({ op: z.literal("event.upsert"), mapId: idSchema, event: mapEventSchema }),
  z.strictObject({ op: z.literal("event.move"), mapId: idSchema, id: idSchema, x: coord, y: coord }),
  z.strictObject({ op: z.literal("event.remove"), mapId: idSchema, id: idSchema }),
  z.strictObject({ op: z.literal("actor.upsert"), actor: actorSchema }),
  z.strictObject({ op: z.literal("actor.remove"), id: idSchema }),
  z.strictObject({ op: z.literal("item.upsert"), item: itemSchema }),
  z.strictObject({ op: z.literal("item.remove"), id: idSchema }),
  z.strictObject({ op: z.literal("quest.upsert"), quest: questSchema }),
  z.strictObject({ op: z.literal("quest.remove"), id: idSchema }),
  z.strictObject({ op: z.literal("ending.upsert"), ending: endingSchema }),
  z.strictObject({ op: z.literal("ending.remove"), id: idSchema }),
  /** 成就：條件成立時解鎖；結局會自動產生成就，不必另外寫 */
  z.strictObject({ op: z.literal("achievement.upsert"), achievement: achievementSchema }),
  z.strictObject({ op: z.literal("achievement.remove"), id: idSchema }),
  /** 新章節加在最後；before 可指定插在哪一章之前 */
  z.strictObject({ op: z.literal("chapter.upsert"), chapter: chapterSchema, before: idSchema.optional() }),
  z.strictObject({ op: z.literal("chapter.remove"), id: idSchema }),
  z.strictObject({ op: z.literal("commonEvent.upsert"), commonEvent: commonEventSchema }),
  z.strictObject({ op: z.literal("commonEvent.remove"), id: idSchema }),
  z.strictObject({ op: z.literal("switch.upsert"), switch: named }),
  z.strictObject({ op: z.literal("switch.remove"), id: idSchema }),
  z.strictObject({ op: z.literal("variable.upsert"), variable: named }),
  z.strictObject({ op: z.literal("variable.remove"), id: idSchema }),
]);
export type StudioOp = z.infer<typeof opSchema>;

export type OpResult = { ok: boolean; message: string };
export type ApplyResult = { project: GameProject; results: OpResult[]; report: ValidationReport | null };

/** 操作的人類可讀描述（顯示在版本紀錄） */
export function describeOp(op: StudioOp): string {
  switch (op.op) {
    case "project.update":
      return "修改遊戲資訊";
    case "system.update":
      return "修改系統設定";
    case "map.add":
      return `新增地圖「${op.name}」`;
    case "map.update":
      return `修改地圖屬性 ${op.id}`;
    case "map.resize":
      return `調整地圖大小為 ${op.width}×${op.height}`;
    case "map.remove":
      return `刪除地圖 ${op.id}`;
    case "map.terrain":
      return `繪製整張地圖 ${op.mapId}`;
    case "map.paint":
      return `繪製地形 ${op.cells.length} 格`;
    case "map.fill":
      return `油漆桶填滿「${TERRAIN[op.ch]?.name ?? op.ch}」`;
    case "event.upsert":
      return `設定事件「${op.event.name}」`;
    case "event.move":
      return `移動事件 ${op.id} 到 (${op.x},${op.y})`;
    case "event.remove":
      return `刪除事件 ${op.id}`;
    case "actor.upsert":
      return `設定角色「${op.actor.name}」`;
    case "actor.remove":
      return `刪除角色 ${op.id}`;
    case "item.upsert":
      return `設定物品「${op.item.name}」`;
    case "item.remove":
      return `刪除物品 ${op.id}`;
    case "quest.upsert":
      return `設定任務「${op.quest.title}」`;
    case "quest.remove":
      return `刪除任務 ${op.id}`;
    case "ending.upsert":
      return `設定結局「${op.ending.title}」`;
    case "ending.remove":
      return `刪除結局 ${op.id}`;
    case "achievement.upsert":
      return `設定成就「${op.achievement.title}」`;
    case "achievement.remove":
      return `刪除成就 ${op.id}`;
    case "chapter.upsert":
      return `設定章節「${op.chapter.title}」`;
    case "chapter.remove":
      return `刪除章節 ${op.id}`;
    case "commonEvent.upsert":
      return `設定共用事件「${op.commonEvent.name}」`;
    case "commonEvent.remove":
      return `刪除共用事件 ${op.id}`;
    case "switch.upsert":
      return `設定開關「${op.switch.name}」`;
    case "switch.remove":
      return `刪除開關 ${op.id}`;
    case "variable.upsert":
      return `設定變數「${op.variable.name}」`;
    case "variable.remove":
      return `刪除變數 ${op.id}`;
  }
}

function mapOf(p: GameProject, id: string): MapDefinition {
  const map = p.maps.find((m) => m.id === id);
  if (!map) throw new Error(`找不到地圖「${id}」`);
  return map;
}

function upsert<T extends { id: string }>(list: T[], value: T) {
  const i = list.findIndex((x) => x.id === value.id);
  if (i >= 0) list[i] = value;
  else list.push(value);
}

function remove<T extends { id: string }>(list: T[], id: string): T[] {
  if (!list.some((x) => x.id === id)) throw new Error(`找不到「${id}」`);
  return list.filter((x) => x.id !== id);
}

function checkChar(ch: string) {
  if (!TERRAIN[ch]) throw new Error(`未知的地形字元「${ch}」（可用：${Object.keys(TERRAIN).join("")}）`);
}

function setCell(map: MapDefinition, x: number, y: number, ch: string) {
  checkChar(ch);
  if (x >= map.width || y >= map.height) return;
  const row = [...map.terrain[y]];
  row[x] = ch;
  map.terrain[y] = row.join("");
}

/** 新地圖：外圍用樹圍起來 */
export function borderedTerrain(width: number, height: number, fill = ".") {
  return Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "T" : fill)).join(""));
}

/** 維護衍生資料：walkable、尺寸、素材清單、未定義的開關與變數 */
function normalize(p: GameProject) {
  for (const map of p.maps) {
    map.height = map.terrain.length;
    map.width = Math.max(...map.terrain.map((r) => [...r].length));
    map.walkable = walkableFromTerrain(map.terrain);
  }
  const used = new Set<string>();
  p.maps.forEach((m) => {
    if (m.tilesetId) used.add(m.tilesetId);
    // 地形用到的圖塊表（城市、室內）也要列入素材清單
    for (const ch of new Set(m.terrain.join(""))) {
      const def = TERRAIN[ch];
      if (!def) continue;
      for (const src of [terrainSheet(def), terrainSheet(terrainUnder(def))]) if (SHEET_TILESET_ID[src]) used.add(SHEET_TILESET_ID[src]);
    }
    m.events.forEach((e) => e.pages.forEach((pg) => pg.graphic && used.add(pg.graphic.assetId)));
  });
  p.actors.forEach((a) => a.spriteAssetId && used.add(a.spriteAssetId));
  p.items.forEach((i) => i.iconAssetId && used.add(i.iconAssetId));
  p.cover?.characterAssetIds?.forEach((id) => used.add(id));
  for (const id of used) if (findCatalogAsset(id) && !p.assetManifest.assets.some((a) => a.id === id)) p.assetManifest.assets.push(manifestEntry(id));

  const switches = new Set<string>();
  const variables = new Set<string>();
  walkProject(p, (c) => {
    if (c.code === "switch") c.ids.forEach((id) => switches.add(id));
    if (c.code === "variable") variables.add(c.id);
  });
  allConditions(p).forEach((c) =>
    walkCondition(c, (a) => {
      if (a.type === "switch") switches.add(a.id);
      if (a.type === "variable") variables.add(a.id);
    }),
  );
  p.commonEvents.forEach((c) => c.switchId && switches.add(c.switchId));
  p.chapters.forEach((ch) => {
    ch.testStart?.switches?.forEach((id) => switches.add(id));
    Object.keys(ch.testStart?.variables ?? {}).forEach((id) => variables.add(id));
  });
  for (const id of switches) if (!p.switches.some((s) => s.id === id)) p.switches.push({ id, name: id });
  for (const id of variables) if (!p.variables.some((v) => v.id === id)) p.variables.push({ id, name: id });
}

function applyOne(p: GameProject, op: StudioOp) {
  switch (op.op) {
    case "project.update": {
      const { op: _op, ...fields } = op;
      void _op;
      Object.assign(p, Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
      return;
    }
    case "system.update":
      if (op.start) {
        const m = mapOf(p, op.start.mapId);
        if (!m.walkable[op.start.y]?.[op.start.x]) throw new Error(`起點 (${op.start.x},${op.start.y}) 不可通行`);
        p.system.start = op.start;
      }
      if (op.playerActorId) p.system.playerActorId = op.playerActorId;
      if (op.initialItems) p.system.initialItems = op.initialItems;
      if (op.clock === null) delete p.system.clock;
      else if (op.clock) {
        p.system.clock = op.clock;
        // 內建變數：第幾天、第幾個時段（事件頁與條件分支用一般的變數條件讀取）
        for (const [id, name] of [["day", "第幾天（時段與日程）"], ["period", "目前的時段（0 起算）"]] as const)
          if (!p.variables.some((v) => v.id === id)) p.variables.push({ id, name });
      }
      return;
    case "map.add": {
      if (p.maps.some((m) => m.id === op.id)) throw new Error(`地圖 ID「${op.id}」已存在`);
      if (op.fill) checkChar(op.fill);
      if (op.parentId) mapOf(p, op.parentId);
      const terrain = borderedTerrain(op.width, op.height, op.fill);
      p.maps.push({
        id: op.id,
        name: op.name,
        ...(op.parentId ? { parentId: op.parentId } : {}),
        width: op.width,
        height: op.height,
        tileSize: 40,
        tilesetId: "tileset_tiny_town",
        terrain,
        walkable: walkableFromTerrain(terrain),
        ...(op.music ? { music: op.music } : {}),
        ...(op.view ? { view: op.view } : {}),
        events: [],
      });
      return;
    }
    case "map.update": {
      const m = mapOf(p, op.id);
      if (op.name !== undefined) m.name = op.name;
      if (op.music === null) delete m.music;
      else if (op.music !== undefined) m.music = op.music;
      if (op.view === null) delete m.view;
      else if (op.view !== undefined) m.view = op.view;
      if (op.parentId === null) delete m.parentId;
      else if (op.parentId !== undefined) {
        if (op.parentId === m.id) throw new Error("地圖不能是自己的上層");
        mapOf(p, op.parentId);
        m.parentId = op.parentId;
      }
      return;
    }
    case "map.resize": {
      const m = mapOf(p, op.id);
      const fill = op.fill ?? ".";
      checkChar(fill);
      m.terrain = Array.from({ length: op.height }, (_, y) => Array.from({ length: op.width }, (_, x) => [...(m.terrain[y] ?? "")][x] ?? fill).join(""));
      m.events = m.events.filter((e) => e.x < op.width && e.y < op.height);
      return;
    }
    case "map.remove":
      if (p.maps.length <= 1) throw new Error("至少要保留一張地圖");
      if (p.system.start.mapId === op.id) throw new Error("這是玩家的起始地圖，請先把起點移到其他地圖");
      p.maps = remove(p.maps, op.id);
      p.maps.forEach((m) => m.parentId === op.id && delete m.parentId);
      return;
    case "map.terrain": {
      const m = mapOf(p, op.mapId);
      const width = [...op.rows[0]].length;
      op.rows.forEach((row, y) => {
        if ([...row].length !== width) throw new Error(`第 ${y} 列有 ${[...row].length} 格，第 0 列有 ${width} 格；每列長度要相同`);
        [...row].forEach(checkChar);
      });
      m.terrain = [...op.rows];
      m.events = m.events.filter((e) => e.x < width && e.y < op.rows.length);
      return;
    }
    case "map.paint": {
      const m = mapOf(p, op.mapId);
      op.cells.forEach((c) => setCell(m, c.x, c.y, c.ch));
      return;
    }
    case "map.fill": {
      const m = mapOf(p, op.mapId);
      checkChar(op.ch);
      const grid = m.terrain.map((r) => [...r]);
      const target = grid[op.y]?.[op.x];
      if (target === undefined || target === op.ch) return;
      const stack: Array<[number, number]> = [[op.x, op.y]];
      while (stack.length) {
        const [x, y] = stack.pop()!;
        if (grid[y]?.[x] !== target) continue;
        grid[y][x] = op.ch;
        stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      m.terrain = grid.map((r) => r.join(""));
      return;
    }
    case "event.upsert": {
      const m = mapOf(p, op.mapId);
      if (op.event.x >= m.width || op.event.y >= m.height) throw new Error(`事件位置 (${op.event.x},${op.event.y}) 超出地圖範圍`);
      upsert(m.events, op.event);
      return;
    }
    case "event.move": {
      const m = mapOf(p, op.mapId);
      const e = m.events.find((x) => x.id === op.id);
      if (!e) throw new Error(`找不到事件「${op.id}」`);
      if (op.x >= m.width || op.y >= m.height) throw new Error("超出地圖範圍");
      Object.assign(e, { x: op.x, y: op.y });
      return;
    }
    case "event.remove": {
      const m = mapOf(p, op.mapId);
      m.events = remove(m.events, op.id);
      return;
    }
    case "actor.upsert":
      upsert(p.actors, op.actor);
      return;
    case "actor.remove":
      if (op.id === p.system.playerActorId) throw new Error("不能刪除主角");
      p.actors = remove(p.actors, op.id);
      return;
    case "item.upsert":
      upsert(p.items, op.item);
      return;
    case "item.remove":
      p.items = remove(p.items, op.id);
      return;
    case "quest.upsert":
      upsert(p.quests, op.quest);
      return;
    case "quest.remove":
      p.quests = remove(p.quests, op.id);
      return;
    case "ending.upsert":
      upsert(p.endings, op.ending);
      return;
    case "ending.remove":
      if (p.endings.length <= 1) throw new Error("至少要保留一個結局");
      p.endings = remove(p.endings, op.id);
      return;
    case "achievement.upsert":
      p.achievements ??= [];
      upsert(p.achievements, op.achievement);
      return;
    case "achievement.remove":
      p.achievements = remove(p.achievements ?? [], op.id);
      return;
    case "chapter.upsert": {
      const i = p.chapters.findIndex((c) => c.id === op.chapter.id);
      if (i >= 0) p.chapters[i] = op.chapter;
      else {
        const at = op.before ? p.chapters.findIndex((c) => c.id === op.before) : -1;
        if (at >= 0) p.chapters.splice(at, 0, op.chapter);
        else p.chapters.push(op.chapter);
      }
      return;
    }
    case "chapter.remove":
      p.chapters = remove(p.chapters, op.id);
      return;
    case "commonEvent.upsert":
      upsert(p.commonEvents, op.commonEvent);
      return;
    case "commonEvent.remove":
      p.commonEvents = remove(p.commonEvents, op.id);
      return;
    case "switch.upsert":
      upsert(p.switches, op.switch);
      return;
    case "switch.remove":
      p.switches = remove(p.switches, op.id);
      return;
    case "variable.upsert":
      upsert(p.variables, op.variable);
      return;
    case "variable.remove":
      p.variables = remove(p.variables, op.id);
      return;
  }
}

/**
 * 依序套用操作。單筆操作失敗不會影響其他操作（結果逐筆回報）；套用後重新驗證整份專案。
 * 中途狀態允許暫時不合法（例如先放事件再補對應的結局），由驗證報告提示。
 * options.validate=false：不做整份驗證（伺服器端使用，避免超過 CPU 限制；驗證由瀏覽器或 CLI 執行）
 */
export function applyOps(project: GameProject, rawOps: unknown[], options: { validate?: boolean } = {}): ApplyResult {
  const p = structuredClone(project);
  const results: OpResult[] = [];
  for (const raw of rawOps) {
    const parsed = opSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      results.push({ ok: false, message: `操作格式錯誤：${issue?.path.join(".")} ${issue?.message}` });
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
  if (options.validate === false) return { project: p, results, report: null };
  const v = validateProject(p);
  return { project: p, results, report: { isValid: v.isValid, errors: v.errors, warnings: v.warnings } };
}

/** 空白專案：一張起始地圖、主角、一個佔位結局（Studio「新增專案」與 CLI 共用） */
export function blankProject(id: string, title: string, genre: GameProject["genre"] = "fantasy"): GameProject {
  const terrain = borderedTerrain(24, 16);
  return {
    schemaVersion: "2.0",
    id,
    title,
    description: "（待補）",
    genre,
    system: { start: { mapId: "start", x: 3, y: 3 }, playerActorId: "player", initialItems: [] },
    actors: [{ id: "player", name: "主角", spriteAssetId: "char_hero" }],
    items: [],
    quests: [],
    endings: [{ id: "end_placeholder", title: "（佔位結局）", text: "請以 ending.upsert 取代這個佔位結局，並用「結局」指令觸發。" }],
    chapters: [],
    switches: [],
    variables: [],
    commonEvents: [],
    maps: [{ id: "start", name: "起點", width: 24, height: 16, tileSize: 40, tilesetId: "tileset_tiny_town", terrain, walkable: walkableFromTerrain(terrain), music: "peaceful", events: [] }],
    assetManifest: { assets: ["tileset_tiny_town", "char_hero"].map(manifestEntry) },
  };
}
