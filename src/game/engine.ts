import { resolveList, sourceKey, sourceRoot, type CommandPath, type CommandSource } from "./commands";
import type { Direction, EventCommand, EventPage, GameCondition, GameProject, MapDefinition, MapEvent, PageConditions, QuestStatus } from "./schema";

/**
 * 確定性的 RPG Runtime（RPG Maker 式事件直譯器）。
 * 所有動作都是 (project, state) => 新 state 的純函式；畫面與輸入只負責呈現。
 *
 * 規則（與 RPG Maker MZ 相同）：
 * - 事件頁：選「條件成立、編號最大」的那一頁；沒有任何一頁成立時，事件不存在（不顯示、不擋路）。
 * - 觸發：確定鍵（同層看面前一格，在角色下／上看腳下）、接觸（走上去，或撞到同層事件）、自動執行（頁面成立就執行，執行中玩家不能動）。
 * - 執行內容依序執行；遇到「顯示文字／選項／章節標題」就停下來等玩家輸入。
 * - 場所移動之後事件會繼續執行；結局指令會結束遊戲。
 * 執行狀態（直譯器位置）存在 PlayerState 裡，所以存檔、讀檔、自動試玩都能從任意時點繼續。
 */

export type { Direction } from "./schema";

export type QuestProgress = { status: QuestStatus; step: number };

export type Frame = { source: CommandSource; path: CommandPath; index: number };
export type Interpreter = { frames: Frame[]; event: { mapId: string; eventId: string } | null };

export type Message =
  | { kind: "text"; text: string; actorId?: string; speaker?: string; choices?: Array<{ index: number; text: string }> }
  | { kind: "chapter"; chapterId: string };

export type PlayerState = {
  schemaVersion: "2.0";
  projectId: string;
  /** 對應的 GameProject 內容指紋；專案內容變更後舊存檔會被視為不相容 */
  projectRevision: string;
  mapId: string;
  x: number;
  y: number;
  facing: Direction;
  switches: Record<string, boolean>;
  variables: Record<string, number>;
  /** `地圖ID/事件ID/A` */
  selfSwitches: Record<string, boolean>;
  items: Record<string, number>;
  quests: Record<string, QuestProgress>;
  /** 目前地圖中被「暫時消除」的事件 */
  erased: string[];
  chapterId: string | null;
  interpreter: Interpreter | null;
  message: Message | null;
  endingId: string | null;
  /** 「背景音樂」指令的覆寫；undefined＝使用地圖設定 */
  music?: string | null;
  steps: number;
  /** 做過的選擇（來源／位置／選項），給品質指標與結局分析 */
  choiceLog: string[];
};

export type GameEvent =
  | { type: "moved" }
  | { type: "blocked" }
  | { type: "transferred"; mapId: string }
  | { type: "event_started"; mapId: string; eventId: string }
  | { type: "message" }
  | { type: "item"; itemId: string; delta: number }
  | { type: "quest"; questId: string; action: "start" | "step" | "complete" | "fail" }
  | { type: "chapter"; chapterId: string }
  | { type: "music"; mood: string | null }
  | { type: "ending"; endingId: string };

export type ActionResult = { state: PlayerState; events: GameEvent[] };

export class EngineError extends Error {}

const DELTA: Record<Direction, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const MAX_STEPS_PER_RUN = 20000;
const MAX_FRAMES = 60;

// ---------- 查詢 ----------

export function getMap(project: GameProject, mapId: string): MapDefinition {
  const map = project.maps.find((m) => m.id === mapId);
  if (!map) throw new EngineError(`找不到地圖 ${mapId}`);
  return map;
}

export function actorOf(project: GameProject, id?: string) {
  return id ? project.actors.find((a) => a.id === id) : undefined;
}

export function playerActor(project: GameProject) {
  return actorOf(project, project.system.playerActorId) ?? project.actors[0];
}

/** 計算專案內容指紋（FNV-1a），用來判斷存檔是否對應同一版專案 */
export function projectRevision(project: GameProject): string {
  const text = JSON.stringify(project);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ---------- 條件 ----------

export type EventContext = { mapId: string; eventId: string } | null;

export function selfSwitchKey(mapId: string, eventId: string, key: string) {
  return `${mapId}/${eventId}/${key}`;
}

function compare(a: number, op: string, b: number) {
  switch (op) {
    case "==":
      return a === b;
    case "!=":
      return a !== b;
    case ">=":
      return a >= b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    default:
      return a < b;
  }
}

export function evaluateCondition(state: PlayerState, c: GameCondition, ctx: EventContext = null): boolean {
  switch (c.type) {
    case "switch":
      return (state.switches[c.id] === true) === c.value;
    case "variable":
      return compare(state.variables[c.id] ?? 0, c.op, c.value);
    case "selfSwitch":
      return ctx ? (state.selfSwitches[selfSwitchKey(ctx.mapId, ctx.eventId, c.key)] === true) === c.value : !c.value;
    case "item":
      return (state.items[c.itemId] ?? 0) >= (c.count ?? 1);
    case "quest": {
      const q = state.quests[c.questId] ?? { status: "inactive", step: 0 };
      return q.status === c.status && (c.step === undefined || q.step === c.step);
    }
    case "chapter":
      return state.chapterId === c.chapterId;
    case "all":
      return c.conditions.every((x) => evaluateCondition(state, x, ctx));
    case "any":
      return c.conditions.some((x) => evaluateCondition(state, x, ctx));
    case "not":
      return !evaluateCondition(state, c.condition, ctx);
  }
}

export function pageConditionsMet(state: PlayerState, c: PageConditions | undefined, ctx: EventContext): boolean {
  if (!c) return true;
  if (c.switches?.some((id) => state.switches[id] !== true)) return false;
  if (c.variable && (state.variables[c.variable.id] ?? 0) < c.variable.min) return false;
  if (c.selfSwitch && !(ctx && state.selfSwitches[selfSwitchKey(ctx.mapId, ctx.eventId, c.selfSwitch)])) return false;
  if (c.itemId && (state.items[c.itemId] ?? 0) < 1) return false;
  if (c.quest && (state.quests[c.quest.questId]?.status ?? "inactive") !== c.quest.status) return false;
  if (c.custom && !evaluateCondition(state, c.custom, ctx)) return false;
  return true;
}

/** 事件目前生效的頁面（條件成立、編號最大）；被暫時消除或沒有成立的頁面時回傳 null */
export function activePage(state: PlayerState, mapId: string, event: MapEvent): { page: EventPage; index: number } | null {
  if (mapId === state.mapId && state.erased.includes(event.id)) return null;
  const ctx = { mapId, eventId: event.id };
  for (let i = event.pages.length - 1; i >= 0; i--) {
    if (pageConditionsMet(state, event.pages[i].conditions, ctx)) return { page: event.pages[i], index: i };
  }
  return null;
}

/** 目前地圖上存在的事件與生效頁 */
export function visibleEvents(project: GameProject, state: PlayerState, mapId = state.mapId) {
  const out: Array<{ event: MapEvent; page: EventPage; index: number }> = [];
  for (const event of getMap(project, mapId).events) {
    const active = activePage(state, mapId, event);
    if (active) out.push({ event, ...active });
  }
  return out;
}

export function eventsAt(project: GameProject, state: PlayerState, x: number, y: number, mapId = state.mapId) {
  return visibleEvents(project, state, mapId).filter((e) => e.event.x === x && e.event.y === y);
}

export function isWalkableTile(map: MapDefinition, x: number, y: number) {
  return x >= 0 && y >= 0 && x < map.width && y < map.height && map.walkable[y]?.[x] === true;
}

/** 這一格能不能走：地形可通行，而且沒有「與角色同層」的事件擋住 */
export function canPass(project: GameProject, state: PlayerState, x: number, y: number, mapId = state.mapId) {
  if (!isWalkableTile(getMap(project, mapId), x, y)) return false;
  return !eventsAt(project, state, x, y, mapId).some((e) => e.page.priority === "same");
}

export function isBusy(state: PlayerState) {
  return state.interpreter !== null || state.message !== null || state.endingId !== null;
}

export function facedTile(state: Pick<PlayerState, "x" | "y" | "facing">) {
  const [dx, dy] = DELTA[state.facing];
  return { x: state.x + dx, y: state.y + dy };
}

// ---------- 初始化 ----------

function blankState(project: GameProject): PlayerState {
  const items: Record<string, number> = {};
  for (const it of project.system.initialItems) items[it.itemId] = (items[it.itemId] ?? 0) + it.count;
  const { start } = project.system;
  return {
    schemaVersion: "2.0",
    projectId: project.id,
    projectRevision: projectRevision(project),
    mapId: start.mapId,
    x: start.x,
    y: start.y,
    facing: start.direction ?? "down",
    switches: {},
    variables: {},
    selfSwitches: {},
    items,
    quests: {},
    erased: [],
    chapterId: null,
    interpreter: null,
    message: null,
    endingId: null,
    steps: 0,
    choiceLog: [],
  };
}

export function createInitialState(project: GameProject): PlayerState {
  const s = blankState(project);
  run(project, s, []);
  return s;
}

/** 從某一章開始（測試遊玩用）：套用章節的測試起點狀態，再執行自動執行事件 */
export function createChapterState(project: GameProject, chapterId: string): PlayerState {
  const chapter = project.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new EngineError(`找不到章節 ${chapterId}`);
  const s = blankState(project);
  const t = chapter.testStart;
  if (t) {
    Object.assign(s, { mapId: t.mapId, x: t.x, y: t.y });
    t.switches?.forEach((id) => (s.switches[id] = true));
    Object.assign(s.variables, t.variables ?? {});
    Object.assign(s.items, t.items ?? {});
    Object.assign(s.quests, structuredClone(t.quests ?? {}));
  }
  s.chapterId = chapter.id;
  run(project, s, []);
  return s;
}

/**
 * 把舊進度對齊到新版內容（遊戲更新後讀檔、測試遊玩中套用修改）：
 * 地圖或位置已不存在就回到起點；執行中的事件位置失效就中止事件。開關、變數、物品等原樣保留。
 */
export function reconcileState(project: GameProject, input: PlayerState): PlayerState {
  const s = clone(input);
  s.projectRevision = projectRevision(project);
  const map = project.maps.find((m) => m.id === s.mapId);
  if (!map) Object.assign(s, { mapId: project.system.start.mapId, x: project.system.start.x, y: project.system.start.y, erased: [] });
  else if (!isWalkableTile(map, s.x, s.y)) {
    // 位置不可通行（地形被改掉、瞬間移動到地圖上）：移到最近的可通行格
    const cx = s.x < 0 ? map.width >> 1 : Math.min(s.x, map.width - 1);
    const cy = s.y < 0 ? map.height >> 1 : Math.min(s.y, map.height - 1);
    let best: [number, number] | null = null;
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++)
        if (isWalkableTile(map, x, y) && (!best || Math.abs(x - cx) + Math.abs(y - cy) < Math.abs(best[0] - cx) + Math.abs(best[1] - cy))) best = [x, y];
    if (best) Object.assign(s, { x: best[0], y: best[1] });
    else Object.assign(s, { mapId: project.system.start.mapId, x: project.system.start.x, y: project.system.start.y, erased: [] });
  }
  if (s.interpreter && !s.interpreter.frames.every((f) => sourceRoot(project, f.source) && resolveList(sourceRoot(project, f.source)!, f.path))) {
    s.interpreter = null;
    s.message = null;
  }
  if (!s.interpreter && s.message?.kind === "text") s.message = null;
  if (s.endingId && !project.endings.some((e) => e.id === s.endingId)) s.endingId = null;
  s.choiceLog ??= [];
  return s;
}

// ---------- 直譯器 ----------

function clone(state: PlayerState): PlayerState {
  return structuredClone(state);
}

function signature(s: PlayerState) {
  return JSON.stringify([s.mapId, s.x, s.y, s.switches, s.variables, s.selfSwitches, s.items, s.quests, s.erased, s.chapterId]);
}

function findAutorun(project: GameProject, s: PlayerState): { source: CommandSource; event: Interpreter["event"]; name: string } | null {
  for (const v of visibleEvents(project, s)) {
    if (v.page.trigger === "autorun") return { source: { kind: "event", mapId: s.mapId, eventId: v.event.id, page: v.index }, event: { mapId: s.mapId, eventId: v.event.id }, name: v.event.name };
  }
  for (const c of project.commonEvents) {
    if (c.trigger === "autorun" && c.switchId && s.switches[c.switchId] === true) return { source: { kind: "common", id: c.id }, event: null, name: c.name };
  }
  return null;
}

function startEvent(s: PlayerState, mapId: string, event: MapEvent, page: number, events: GameEvent[]) {
  s.interpreter = { frames: [{ source: { kind: "event", mapId, eventId: event.id, page }, path: [], index: 0 }], event: { mapId, eventId: event.id } };
  events.push({ type: "event_started", mapId, eventId: event.id });
}

function visibleOptions(s: PlayerState, cmd: Extract<EventCommand, { code: "choices" }>, ctx: EventContext) {
  return cmd.options.flatMap((o, index) => (!o.condition || evaluateCondition(s, o.condition, ctx) ? [{ index, text: o.text }] : []));
}

/** 執行事件直到需要玩家輸入（或沒有事件可執行） */
function run(project: GameProject, s: PlayerState, events: GameEvent[]) {
  let budget = MAX_STEPS_PER_RUN;
  const autorunSeen = new Set<string>();
  for (;;) {
    if (s.endingId || s.message) return;
    if (!s.interpreter) {
      const auto = findAutorun(project, s);
      if (!auto) return;
      const sig = sourceKey(auto.source) + signature(s);
      if (autorunSeen.has(sig)) {
        throw new EngineError(`自動執行的事件「${auto.name}」執行完後條件仍然成立，會無限重複。請在最後打開獨立開關或關閉觸發它的開關。`);
      }
      autorunSeen.add(sig);
      s.interpreter = { frames: [{ source: auto.source, path: [], index: 0 }], event: auto.event };
      continue;
    }
    if (--budget <= 0) throw new EngineError("事件指令執行超過 20000 步，可能有無限迴圈（例如跳轉到自己前面的標籤）");
    const frames = s.interpreter.frames;
    const frame = frames[frames.length - 1];
    if (!frame) {
      s.interpreter = null;
      continue;
    }
    const root = sourceRoot(project, frame.source);
    const list = root && resolveList(root, frame.path);
    if (!list || frame.index >= list.length) {
      frames.pop();
      if (frames.length === 0) s.interpreter = null;
      continue;
    }
    const cmd = list[frame.index++];
    exec(project, s, cmd, frame, list, root!, events);
  }
}

function exec(project: GameProject, s: PlayerState, cmd: EventCommand, frame: Frame, list: EventCommand[], root: EventCommand[], events: GameEvent[]) {
  const interp = s.interpreter!;
  const ctx = interp.event;
  switch (cmd.code) {
    case "text": {
      const msg: Extract<Message, { kind: "text" }> = { kind: "text", text: cmd.text, ...(cmd.actorId ? { actorId: cmd.actorId } : {}), ...(cmd.speaker ? { speaker: cmd.speaker } : {}) };
      const next = list[frame.index];
      if (next?.code === "choices") {
        const options = visibleOptions(s, next, ctx);
        frame.index++;
        if (options.length > 0) msg.choices = options;
      }
      s.message = msg;
      events.push({ type: "message" });
      return;
    }
    case "choices": {
      const options = visibleOptions(s, cmd, ctx);
      if (options.length === 0) return;
      s.message = { kind: "text", text: "", choices: options };
      events.push({ type: "message" });
      return;
    }
    case "if": {
      const branch = evaluateCondition(s, cmd.condition, ctx) ? "then" : "else";
      const sub = branch === "then" ? cmd.then : cmd.else;
      if (sub && sub.length > 0) pushFrame(interp, { source: frame.source, path: [...frame.path, frame.index - 1, branch], index: 0 });
      return;
    }
    case "switch":
      cmd.ids.forEach((id) => (s.switches[id] = cmd.value));
      return;
    case "selfSwitch":
      if (ctx) s.selfSwitches[selfSwitchKey(ctx.mapId, ctx.eventId, cmd.key)] = cmd.value;
      return;
    case "variable": {
      const cur = s.variables[cmd.id] ?? 0;
      s.variables[cmd.id] = cmd.op === "set" ? cmd.value : cmd.op === "add" ? cur + cmd.value : cur - cmd.value;
      return;
    }
    case "item": {
      const cur = s.items[cmd.itemId] ?? 0;
      const next = Math.max(0, cur + cmd.delta);
      if (next === cur) return;
      if (next === 0) delete s.items[cmd.itemId];
      else s.items[cmd.itemId] = next;
      events.push({ type: "item", itemId: cmd.itemId, delta: next - cur });
      return;
    }
    case "quest": {
      const q = s.quests[cmd.questId] ?? { status: "inactive", step: 0 };
      if (cmd.action === "start" && q.status === "inactive") s.quests[cmd.questId] = { status: "active", step: cmd.step ?? 0 };
      else if (cmd.action === "step") s.quests[cmd.questId] = { status: "active", step: cmd.step ?? q.step + 1 };
      else if (cmd.action === "complete") s.quests[cmd.questId] = { status: "completed", step: q.step };
      else if (cmd.action === "fail") s.quests[cmd.questId] = { status: "failed", step: q.step };
      else return;
      events.push({ type: "quest", questId: cmd.questId, action: cmd.action });
      return;
    }
    case "transfer":
      getMap(project, cmd.mapId);
      Object.assign(s, { mapId: cmd.mapId, x: cmd.x, y: cmd.y, erased: [] });
      if (cmd.direction) s.facing = cmd.direction;
      events.push({ type: "transferred", mapId: cmd.mapId });
      return;
    case "ending":
      s.endingId = cmd.endingId;
      s.interpreter = null;
      s.message = null;
      events.push({ type: "ending", endingId: cmd.endingId });
      return;
    case "chapter":
      s.chapterId = cmd.chapterId;
      s.message = { kind: "chapter", chapterId: cmd.chapterId };
      events.push({ type: "chapter", chapterId: cmd.chapterId });
      return;
    case "common":
      if (project.commonEvents.some((c) => c.id === cmd.id)) pushFrame(interp, { source: { kind: "common", id: cmd.id }, path: [], index: 0 });
      return;
    case "erase":
      if (ctx && ctx.mapId === s.mapId && !s.erased.includes(ctx.eventId)) s.erased.push(ctx.eventId);
      return;
    case "exit":
      s.interpreter = null;
      return;
    case "jump": {
      // 標籤只在同一個事件頁／共用事件的最外層尋找；跳轉會離開所有巢狀分支
      const at = root.findIndex((c) => c.code === "label" && c.name === cmd.name);
      if (at < 0) return;
      const key = sourceKey(frame.source);
      let base = interp.frames.length - 1;
      while (base > 0 && !(sourceKey(interp.frames[base].source) === key && interp.frames[base].path.length === 0)) base--;
      interp.frames.length = base + 1;
      interp.frames[base].index = at + 1;
      return;
    }
    case "music":
      s.music = cmd.mood;
      events.push({ type: "music", mood: cmd.mood });
      return;
    case "label":
    case "wait":
    case "comment":
      return;
  }
}

function pushFrame(interp: Interpreter, frame: Frame) {
  if (interp.frames.length >= MAX_FRAMES) throw new EngineError("共用事件或條件分支巢狀太深（可能是共用事件互相呼叫）");
  interp.frames.push(frame);
}

// ---------- 玩家動作 ----------

export function move(project: GameProject, input: PlayerState, direction: Direction): ActionResult {
  const events: GameEvent[] = [];
  if (isBusy(input)) return { state: input, events };
  const s = clone(input);
  s.facing = direction;
  const [dx, dy] = DELTA[direction];
  const tx = s.x + dx;
  const ty = s.y + dy;
  const here = eventsAt(project, s, tx, ty);
  const blocker = here.find((e) => e.page.priority === "same");
  if (blocker || !isWalkableTile(getMap(project, s.mapId), tx, ty)) {
    events.push({ type: "blocked" });
    // 撞到「同層、接觸觸發」的事件會觸發它
    if (blocker && blocker.page.trigger === "touch") {
      startEvent(s, s.mapId, blocker.event, blocker.index, events);
      run(project, s, events);
    }
    return { state: s, events };
  }
  s.x = tx;
  s.y = ty;
  s.steps++;
  events.push({ type: "moved" });
  const touched = here.find((e) => e.page.trigger === "touch");
  if (touched) startEvent(s, s.mapId, touched.event, touched.index, events);
  run(project, s, events);
  return { state: s, events };
}

/** 按確定鍵：先看腳下（在角色下／上的事件），再看面前（同層事件） */
export function confirm(project: GameProject, input: PlayerState): ActionResult {
  const events: GameEvent[] = [];
  if (isBusy(input)) return { state: input, events };
  const s = clone(input);
  const under = eventsAt(project, s, s.x, s.y).find((e) => e.page.priority !== "same" && e.page.trigger === "action");
  const front = facedTile(s);
  const target = under ?? eventsAt(project, s, front.x, front.y).find((e) => e.page.priority === "same" && e.page.trigger === "action");
  if (!target) return { state: input, events };
  startEvent(s, s.mapId, target.event, target.index, events);
  run(project, s, events);
  return { state: s, events };
}

/** 文字或章節標題顯示完畢後繼續 */
export function advance(project: GameProject, input: PlayerState): ActionResult {
  const events: GameEvent[] = [];
  if (!input.message || (input.message.kind === "text" && input.message.choices)) return { state: input, events };
  const s = clone(input);
  s.message = null;
  run(project, s, events);
  return { state: s, events };
}

export function choose(project: GameProject, input: PlayerState, optionIndex: number): ActionResult {
  const events: GameEvent[] = [];
  const msg = input.message;
  if (msg?.kind !== "text" || !msg.choices?.some((c) => c.index === optionIndex) || !input.interpreter) return { state: input, events };
  const s = clone(input);
  const interp = s.interpreter!;
  const frame = interp.frames[interp.frames.length - 1];
  const at = frame.index - 1;
  s.message = null;
  s.choiceLog.push(`${sourceKey(frame.source)}@${[...frame.path, at].join(".")}#${optionIndex}`);
  pushFrame(interp, { source: frame.source, path: [...frame.path, at, optionIndex], index: 0 });
  run(project, s, events);
  return { state: s, events };
}

// ---------- 顯示用 ----------

export function messageSpeaker(project: GameProject, msg: Extract<Message, { kind: "text" }>) {
  const actor = actorOf(project, msg.actorId);
  return { name: msg.speaker ?? actor?.name, spriteAssetId: actor?.spriteAssetId, voice: actor?.voice };
}

export function questJournal(project: GameProject, state: PlayerState) {
  return project.quests
    .filter((q) => (state.quests[q.id]?.status ?? "inactive") !== "inactive")
    .map((q) => {
      const p = state.quests[q.id];
      return {
        id: q.id,
        title: q.title,
        description: q.description,
        status: p.status,
        steps: q.steps.slice(0, Math.min(q.steps.length, p.step + 1)).map((st, i) => ({
          text: st.text,
          done: p.status === "completed" || i < p.step,
          current: p.status === "active" && i === p.step,
        })),
      };
    });
}

/** 結局尾聲：依玩家累積的狀態，挑出條件成立的追加描述 */
export function endingEpilogues(project: GameProject, state: PlayerState): string[] {
  const ending = project.endings.find((e) => e.id === state.endingId);
  return (ending?.epilogues ?? []).filter((x) => evaluateCondition(state, x.condition)).map((x) => x.text);
}

/** 執行中的事件（給畫面顯示頭像位置、F9 除錯等） */
export function runningEventName(project: GameProject, state: PlayerState) {
  const ev = state.interpreter?.event;
  return ev ? project.maps.find((m) => m.id === ev.mapId)?.events.find((e) => e.id === ev.eventId)?.name : undefined;
}
