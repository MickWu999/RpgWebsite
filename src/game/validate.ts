import { findCatalogAsset, TERRAIN } from "./assets";
import { allConditions, allSources, walkCommands, walkCondition, walkProject } from "./commands";
import { SCHEMA_VERSION, gameProjectSchema, type EventCommand, type GameCondition, type GameProject, type MapDefinition } from "./schema";

/**
 * GameProject 驗證：先做 schema 驗證，再做邏輯驗證（引用、地形、事件頁、指令、標籤、自動執行、共用事件遞迴、地圖可達性、物品取得方式）。
 * 驗證結果由程式產生；人和 AI 都依這裡回傳的錯誤修正。
 */

export type ValidationIssue = { path: string; message: string };
export type ValidationReport = { isValid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] };
export type ValidationResult = ValidationReport & { project?: GameProject };

export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

export function validateProject(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { isValid: false, errors: [{ path: "", message: "GameProject 必須是 JSON 物件" }], warnings: [] };
  }
  const version = (input as Record<string, unknown>).schemaVersion;
  if (version !== SCHEMA_VERSION) {
    return { isValid: false, errors: [{ path: "schemaVersion", message: `不支援的 schemaVersion「${String(version)}」，目前只接受 ${SCHEMA_VERSION}` }], warnings: [] };
  }
  if (JSON.stringify(input).length > MAX_PROJECT_BYTES) {
    return { isValid: false, errors: [{ path: "", message: `專案資料超過 ${MAX_PROJECT_BYTES / 1024 / 1024} MB 上限` }], warnings: [] };
  }
  const parsed = gameProjectSchema.safeParse(input);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => ({ path: i.path.join("."), message: translateZodMessage(i.message, i.code) }));
    return { isValid: false, errors: errors.slice(0, 50), warnings: [] };
  }
  const report = validateLogic(parsed.data);
  return { ...report, project: report.isValid ? parsed.data : undefined };
}

function translateZodMessage(message: string, code: string) {
  if (code === "invalid_type") return `型別錯誤：${message}`;
  if (code === "unrecognized_keys") return `不允許的欄位：${message}`;
  if (code === "invalid_union") return `不支援的指令／條件或格式錯誤：${message}`;
  return message;
}

/** 會讓自動執行事件停下來的指令（沒有這些指令的自動執行頁會無限重複） */
const CLOSING_CODES = new Set<EventCommand["code"]>(["selfSwitch", "switch", "variable", "transfer", "erase", "ending", "quest", "item", "chapter"]);

export function validateLogic(project: GameProject): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const err = (path: string, message: string) => errors.push({ path, message });
  const warn = (path: string, message: string) => warnings.push({ path, message });

  const ids = (name: string, list: Array<{ id: string }>) => {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.id)) err(name, `ID「${x.id}」重複`);
      seen.add(x.id);
    }
    return seen;
  };
  const actors = ids("actors", project.actors);
  ids("achievements", project.achievements ?? []);
  const items = ids("items", project.items);
  const quests = new Map(project.quests.map((q) => [q.id, q]));
  ids("quests", project.quests);
  const endings = ids("endings", project.endings);
  const chapters = ids("chapters", project.chapters);
  const switches = ids("switches", project.switches);
  const variables = ids("variables", project.variables);
  const commons = ids("commonEvents", project.commonEvents);
  const maps = new Map(project.maps.map((m) => [m.id, m]));
  ids("maps", project.maps);

  const assetOk = (id: string | undefined) => !id || project.assetManifest.assets.some((a) => a.id === id) || Boolean(findCatalogAsset(id));
  const asset = (path: string, id: string | undefined) => assetOk(id) || err(path, `素材「${id}」不在素材庫中`);

  // ---------- 系統 ----------
  const start = project.system.start;
  const startMap = maps.get(start.mapId);
  if (!startMap) err("system.start", `起始地圖「${start.mapId}」不存在`);
  else if (!startMap.walkable[start.y]?.[start.x]) err("system.start", `起始位置 (${start.x},${start.y}) 不可通行`);
  if (!actors.has(project.system.playerActorId)) err("system.playerActorId", `主角「${project.system.playerActorId}」不在角色資料庫中`);
  project.system.initialItems.forEach((it, i) => items.has(it.itemId) || err(`system.initialItems[${i}]`, `物品「${it.itemId}」不存在`));
  project.actors.forEach((a, i) => asset(`actors[${i}].spriteAssetId`, a.spriteAssetId));
  project.items.forEach((it, i) => asset(`items[${i}].iconAssetId`, it.iconAssetId));
  project.cover?.characterAssetIds?.forEach((id, i) => asset(`cover.characterAssetIds[${i}]`, id));
  if (project.cover?.mapId && !maps.has(project.cover.mapId)) err("cover.mapId", `封面地圖「${project.cover.mapId}」不存在`);

  // ---------- 地圖 ----------
  for (const m of project.maps) {
    const at = `maps.${m.id}`;
    if (m.terrain.length !== m.height) err(at, `地形列數 ${m.terrain.length} 與地圖高度 ${m.height} 不一致`);
    m.terrain.forEach((row, y) => {
      const chars = [...row];
      if (chars.length !== m.width) err(`${at}.terrain[${y}]`, `第 ${y} 列有 ${chars.length} 格，地圖寬度是 ${m.width}`);
      const unknown = [...new Set(chars.filter((c) => !TERRAIN[c]))];
      if (unknown.length) err(`${at}.terrain[${y}]`, `未知的地形字元「${unknown.join("")}」`);
    });
    if (m.walkable.length !== m.height || m.walkable.some((r) => r.length !== m.width)) err(`${at}.walkable`, "walkable 尺寸與地圖不一致（請用操作 API 修改地形，會自動重算）");
    asset(`${at}.tilesetId`, m.tilesetId);
    if (m.parentId && !maps.has(m.parentId)) err(`${at}.parentId`, `上層地圖「${m.parentId}」不存在`);
    const eventIds = new Set<string>();
    for (const e of m.events) {
      const ep = `${at}.events.${e.id}`;
      if (eventIds.has(e.id)) err(ep, `事件 ID「${e.id}」在這張地圖重複`);
      eventIds.add(e.id);
      if (e.x >= m.width || e.y >= m.height) err(ep, `事件位置 (${e.x},${e.y}) 超出地圖範圍`);
      e.pages.forEach((p, i) => {
        const pp = `${ep}.pages[${i}]`;
        asset(`${pp}.graphic`, p.graphic?.assetId);
        const c = p.conditions;
        c?.switches?.forEach((id) => switches.has(id) || err(pp, `出現條件的開關「${id}」未定義`));
        if (c?.variable && !variables.has(c.variable.id)) err(pp, `出現條件的變數「${c.variable.id}」未定義`);
        if (c?.itemId && !items.has(c.itemId)) err(pp, `出現條件的物品「${c.itemId}」不存在`);
        if (c?.quest && !quests.has(c.quest.questId)) err(pp, `出現條件的任務「${c.quest.questId}」不存在`);
        if (p.trigger === "autorun" && !hasClosing(p.commands)) err(pp, "自動執行的頁面沒有任何會改變狀態的指令（例如打開獨立開關），會無限重複執行");
        if (p.trigger === "touch" && p.priority === "same" && !p.graphic) warn(pp, "透明的同層接觸事件只會在玩家「撞到」時觸發；觸發區通常應設為「在角色下」");
      });
    }
    for (let i = 0; i < m.events.length; i++)
      for (let j = i + 1; j < m.events.length; j++)
        if (m.events[i].x === m.events[j].x && m.events[i].y === m.events[j].y) warn(at, `事件「${m.events[i].name}」與「${m.events[j].name}」在同一格 (${m.events[i].x},${m.events[i].y})`);
  }
  // 地圖樹不可循環
  for (const m of project.maps) {
    const seen = new Set<string>();
    for (let cur: MapDefinition | undefined = m; cur?.parentId; cur = maps.get(cur.parentId)) {
      if (seen.has(cur.id)) {
        err(`maps.${m.id}.parentId`, "地圖樹的上層關係形成循環");
        break;
      }
      seen.add(cur.id);
    }
  }

  // ---------- 共用事件 ----------
  project.commonEvents.forEach((c, i) => {
    if (c.trigger === "autorun") {
      if (!c.switchId) err(`commonEvents[${i}]`, `自動執行的共用事件「${c.name}」需要指定開關`);
      else if (!switches.has(c.switchId)) err(`commonEvents[${i}]`, `開關「${c.switchId}」未定義`);
      if (!hasClosing(c.commands)) err(`commonEvents[${i}]`, `自動執行的共用事件「${c.name}」沒有會改變狀態的指令，會無限重複執行`);
    }
  });

  // ---------- 指令 ----------
  const usedEndings = new Set<string>();
  const usedQuests = new Set<string>();
  const callGraph = new Map<string, Set<string>>();
  for (const s of allSources(project)) {
    const labels = new Map<string, number>();
    s.commands.forEach((c) => c.code === "label" && labels.set(c.name, (labels.get(c.name) ?? 0) + 1));
    for (const [name, n] of labels) if (n > 1) err(s.label, `標籤「${name}」重複`);
    const from = s.source.kind === "common" ? s.source.id : `@${s.label}`;
    walkCommands(s.commands, (cmd, ctx) => {
      const p = `${s.label}［${[...ctx.path, ctx.index].join(".")}］`;
      switch (cmd.code) {
        case "text":
          if (cmd.actorId && !actors.has(cmd.actorId)) err(p, `顯示文字的角色「${cmd.actorId}」不存在`);
          break;
        case "switch":
          cmd.ids.forEach((id) => switches.has(id) || err(p, `開關「${id}」未定義`));
          break;
        case "variable":
          if (!variables.has(cmd.id)) err(p, `變數「${cmd.id}」未定義`);
          break;
        case "item":
          if (!items.has(cmd.itemId)) err(p, `物品「${cmd.itemId}」不存在`);
          break;
        case "quest": {
          usedQuests.add(cmd.questId);
          const q = quests.get(cmd.questId);
          if (!q) err(p, `任務「${cmd.questId}」不存在`);
          else if (cmd.step !== undefined && cmd.step >= q.steps.length) err(p, `任務「${q.title}」只有 ${q.steps.length} 個步驟（step 從 0 起算），沒有 step ${cmd.step}`);
          break;
        }
        case "transfer": {
          const target = maps.get(cmd.mapId);
          if (!target) err(p, `場所移動的目標地圖「${cmd.mapId}」不存在`);
          else if (!target.walkable[cmd.y]?.[cmd.x]) err(p, `場所移動的目標 ${target.name} (${cmd.x},${cmd.y}) 不可通行`);
          break;
        }
        case "ending":
          usedEndings.add(cmd.endingId);
          if (!endings.has(cmd.endingId)) err(p, `結局「${cmd.endingId}」不存在`);
          break;
        case "chapter":
          if (!chapters.has(cmd.chapterId)) err(p, `章節「${cmd.chapterId}」不存在`);
          break;
        case "common":
          if (!commons.has(cmd.id)) err(p, `共用事件「${cmd.id}」不存在`);
          else (callGraph.get(from) ?? callGraph.set(from, new Set()).get(from)!).add(cmd.id);
          break;
        case "jump":
          if (!labels.has(cmd.name)) err(p, `跳轉的標籤「${cmd.name}」不存在（標籤必須放在同一個事件頁的最外層）`);
          break;
        case "label":
          if (ctx.path.length > 0) err(p, `標籤「${cmd.name}」放在分支裡；標籤只能放在最外層`);
          break;
        case "selfSwitch":
          if (s.source.kind === "common") warn(p, "共用事件裡的獨立開關，作用在「呼叫它的事件」上");
          break;
      }
    });
  }
  // 共用事件互相呼叫形成循環
  const visiting = new Set<string>();
  const done = new Set<string>();
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (done.has(id)) return false;
    visiting.add(id);
    const cyc = [...(callGraph.get(id) ?? [])].some(dfs);
    visiting.delete(id);
    done.add(id);
    return cyc;
  };
  for (const c of project.commonEvents) if (dfs(c.id)) err(`commonEvents.${c.id}`, `共用事件「${c.name}」直接或間接呼叫了自己`);

  // ---------- 條件 ----------
  const conditionRefs = (c: GameCondition, path: string) =>
    walkCondition(c, (a) => {
      if (a.type === "switch" && !switches.has(a.id)) err(path, `條件中的開關「${a.id}」未定義`);
      if (a.type === "variable" && !variables.has(a.id)) err(path, `條件中的變數「${a.id}」未定義`);
      if (a.type === "item" && !items.has(a.itemId)) err(path, `條件中的物品「${a.itemId}」不存在`);
      if (a.type === "chapter" && !chapters.has(a.chapterId)) err(path, `條件中的章節「${a.chapterId}」不存在`);
      if (a.type === "quest") {
        const q = quests.get(a.questId);
        if (!q) err(path, `條件中的任務「${a.questId}」不存在`);
        else if (a.step !== undefined && a.step >= q.steps.length) err(path, `任務「${q.title}」沒有 step ${a.step}`);
      }
    });
  allConditions(project).forEach((c) => conditionRefs(c, "conditions"));

  // ---------- 章節 ----------
  project.chapters.forEach((ch, i) => {
    const t = ch.testStart;
    if (!t) return warn(`chapters[${i}]`, `章節「${ch.title}」沒有設定測試起點，無法「從這一章開始測試」`);
    const m = maps.get(t.mapId);
    if (!m) err(`chapters[${i}].testStart`, `地圖「${t.mapId}」不存在`);
    else if (!m.walkable[t.y]?.[t.x]) err(`chapters[${i}].testStart`, `測試起點 (${t.x},${t.y}) 不可通行`);
    t.switches?.forEach((id) => switches.has(id) || err(`chapters[${i}].testStart`, `開關「${id}」未定義`));
    Object.keys(t.variables ?? {}).forEach((id) => variables.has(id) || err(`chapters[${i}].testStart`, `變數「${id}」未定義`));
    Object.keys(t.items ?? {}).forEach((id) => items.has(id) || err(`chapters[${i}].testStart`, `物品「${id}」不存在`));
    Object.keys(t.quests ?? {}).forEach((id) => quests.has(id) || err(`chapters[${i}].testStart`, `任務「${id}」不存在`));
  });

  // ---------- 結局、任務 ----------
  project.endings.forEach((e, i) => usedEndings.has(e.id) || err(`endings[${i}]`, `結局「${e.title}」沒有任何「結局」指令會觸發它`));
  project.quests.forEach((q, i) => usedQuests.has(q.id) || warn(`quests[${i}]`, `任務「${q.title}」沒有被任何指令使用`));

  checkReachability(project, warn);
  checkObtainability(project, err, warn);
  return { isValid: errors.length === 0, errors: errors.slice(0, 80), warnings: warnings.slice(0, 80) };
}

function hasClosing(list: EventCommand[]) {
  let found = false;
  walkCommands(list, (c) => {
    if (CLOSING_CODES.has(c.code)) found = true;
  });
  return found;
}

/** 從起始地圖沿著「場所移動」指令能到達哪些地圖（共用事件的場所移動視為任何地圖都能使用） */
function checkReachability(project: GameProject, warn: (path: string, message: string) => void) {
  const edges = new Map<string, Set<string>>();
  const global = new Set<string>();
  for (const s of allSources(project)) {
    walkCommands(s.commands, (c) => {
      if (c.code !== "transfer") return;
      if (s.source.kind === "common") global.add(c.mapId);
      else (edges.get(s.source.mapId) ?? edges.set(s.source.mapId, new Set()).get(s.source.mapId)!).add(c.mapId);
    });
  }
  for (const ch of project.chapters) if (ch.testStart) global.add(ch.testStart.mapId);
  const seen = new Set([project.system.start.mapId, ...global]);
  const queue = [...seen];
  while (queue.length) {
    for (const next of edges.get(queue.shift()!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  for (const m of project.maps) if (!seen.has(m.id)) warn(`maps.${m.id}`, `地圖「${m.name}」沒有任何場所移動可以到達`);
}

/** 物品：被消耗或被條件需要，卻沒有任何取得方式；開關：被讀取卻從未被打開 */
function checkObtainability(project: GameProject, err: (path: string, message: string) => void, warn: (path: string, message: string) => void) {
  const gained = new Set(project.system.initialItems.map((i) => i.itemId));
  const consumed = new Set<string>();
  const turnedOn = new Set<string>();
  walkProject(project, (c) => {
    if (c.code === "item") (c.delta > 0 ? gained : consumed).add(c.itemId);
    if (c.code === "switch" && c.value) c.ids.forEach((id) => turnedOn.add(id));
  });
  project.chapters.forEach((ch) => {
    Object.keys(ch.testStart?.items ?? {}).forEach((id) => gained.add(id));
    ch.testStart?.switches?.forEach((id) => turnedOn.add(id));
  });
  for (const id of consumed) if (!gained.has(id)) err("items", `物品「${project.items.find((i) => i.id === id)?.name ?? id}」會被交出，卻沒有任何取得方式`);
  const needed = new Set<string>();
  const readSwitches = new Set<string>();
  allConditions(project).forEach((c) =>
    walkCondition(c, (a) => {
      if (a.type === "item") needed.add(a.itemId);
      if (a.type === "switch" && a.value) readSwitches.add(a.id);
    }),
  );
  for (const id of needed) if (!gained.has(id)) warn("items", `條件需要物品「${project.items.find((i) => i.id === id)?.name ?? id}」，但遊戲中沒有任何取得方式`);
  for (const id of readSwitches) if (!turnedOn.has(id)) warn("switches", `開關「${project.switches.find((s) => s.id === id)?.name ?? id}」被當成條件，卻從來沒有被打開`);
}
