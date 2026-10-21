import { isWalkableTile } from "./engine";
import type { EventCommand, EventPage, GameCondition, GameProject, MapDefinition, MapEvent, PageConditions } from "./schema";
import type { ValidationIssue } from "./validate";

/**
 * 設計防呆（靜態檢查，不需要 AI、不需要試玩，幾毫秒就跑完）：
 * 找出「資料格式正確，但玩家實際上會卡住或永遠看不到」的設計錯誤。
 * 每次 apply 之後立刻執行，回報這批操作新產生的問題；check／publish 時 errors 會擋下發布。
 *
 * L1 事件頁被蓋掉：後面的頁條件比較寬（或沒有條件），前面的頁永遠不會被使用（系統使用「條件成立、編號最大」的頁）
 * L2 條件永遠不成立：需要的開關從來沒被打開、物品拿不到、變數到不了、任務不會進入該狀態、獨立開關沒有被打開
 * L3 走不到的事件：地圖上從任何入口都走不到（或走不到旁邊）的事件
 * L4 困住玩家的區域：從入口進來後，這個區域沒有任何傳送、章節或結局可以離開
 * L5 沒有反應：看得見的事件按確定鍵沒有任何指令；選項沒有任何回應；任務開始後沒有終點
 */

export type LintReport = { errors: ValidationIssue[]; warnings: ValidationIssue[] };

type Where = { mapId?: string; eventId?: string };

/** 走訪指令（含條件分支、選項內的指令） */
function walk(commands: EventCommand[], visit: (c: EventCommand) => void) {
  for (const c of commands) {
    visit(c);
    if (c.code === "if") {
      walk(c.then, visit);
      if (c.else) walk(c.else, visit);
    } else if (c.code === "choices") for (const o of c.options) walk(o.commands, visit);
    else if (c.code === "present") {
      for (const o of c.options) walk(o.commands, visit);
      walk(c.otherwise, visit);
      if (c.cancel) walk(c.cancel, visit);
    }
  }
}

/** 一段指令（展開共用事件）是否包含某種指令 */
function contains(project: GameProject, commands: EventCommand[], test: (c: EventCommand) => boolean, seen = new Set<string>()): boolean {
  let found = false;
  walk(commands, (c) => {
    if (found) return;
    if (test(c)) found = true;
    else if (c.code === "common" && !seen.has(c.id)) {
      seen.add(c.id);
      const ce = project.commonEvents.find((x) => x.id === c.id);
      if (ce && contains(project, ce.commands, test, seen)) found = true;
    }
  });
  return found;
}

/** 整款遊戲「可能做到」的事：哪些開關會被打開、哪些物品拿得到、變數最大到多少、任務會進入哪些狀態 */
function possibilities(project: GameProject) {
  const switchesOn = new Set<string>();
  const items = new Set(project.system.initialItems.map((i) => i.itemId));
  const varMax = new Map<string, number>();
  const questStatus = new Map<string, Set<string>>();
  /** 每個事件自己會打開的獨立開關（共用事件裡的獨立開關作用在呼叫者身上） */
  const selfOn = new Map<string, Set<string>>();
  const note = (cmds: EventCommand[], owner?: string) =>
    walk(cmds, (c) => {
      if (c.code === "switch" && c.value) c.ids.forEach((id) => switchesOn.add(id));
      if (c.code === "item" && c.delta > 0) items.add(c.itemId);
      if (c.code === "variable") {
        const cur = varMax.get(c.id) ?? 0;
        const next = c.op === "add" && c.value > 0 ? Infinity : c.op === "sub" && c.value < 0 ? Infinity : c.op === "set" ? Math.max(cur, c.value) : cur;
        varMax.set(c.id, next);
      }
      if (c.code === "quest") {
        const s = questStatus.get(c.questId) ?? new Set<string>();
        s.add(c.action === "complete" ? "completed" : c.action === "fail" ? "failed" : "active");
        questStatus.set(c.questId, s);
      }
      if (c.code === "selfSwitch" && c.value && owner) {
        const s = selfOn.get(owner) ?? new Set<string>();
        s.add(c.key);
        selfOn.set(owner, s);
      }
    });
  for (const m of project.maps) for (const e of m.events) for (const p of e.pages) note(p.commands, `${m.id}/${e.id}`);
  const commonSelf = new Set<string>();
  for (const ce of project.commonEvents) {
    note(ce.commands);
    walk(ce.commands, (c) => c.code === "selfSwitch" && c.value && commonSelf.add(c.key));
  }
  return { switchesOn, items, varMax, questStatus, selfOn, commonSelf };
}

type Possible = ReturnType<typeof possibilities>;

const switchName = (p: GameProject, id: string) => p.switches.find((s) => s.id === id)?.name ?? id;
const itemName = (p: GameProject, id: string) => p.items.find((s) => s.id === id)?.name ?? id;

/** 條件為什麼永遠不會成立（null＝可能成立） */
function impossibleAtom(project: GameProject, can: Possible, c: GameCondition, owner?: string): string | null {
  switch (c.type) {
    case "switch":
      return c.value && !can.switchesOn.has(c.id) ? `開關「${switchName(project, c.id)}」從來沒有被打開` : null;
    case "item":
      return !can.items.has(c.itemId) ? `物品「${itemName(project, c.itemId)}」在遊戲中拿不到` : null;
    case "variable": {
      const max = can.varMax.get(c.id) ?? 0;
      const need = c.op === ">=" ? c.value : c.op === ">" ? c.value + 1 : c.op === "==" ? c.value : -Infinity;
      return need > max ? `變數「${project.variables.find((v) => v.id === c.id)?.name ?? c.id}」最大只會到 ${max}，到不了 ${need}` : null;
    }
    case "quest":
      return c.status !== "inactive" && !can.questStatus.get(c.questId)?.has(c.status) ? `任務「${project.quests.find((q) => q.id === c.questId)?.title ?? c.questId}」不會進入「${c.status}」狀態` : null;
    case "selfSwitch":
      return c.value && owner && !can.selfOn.get(owner)?.has(c.key) && !can.commonSelf.has(c.key) ? `獨立開關 ${c.key} 從來沒有被這個事件打開` : null;
    case "all":
      for (const x of c.conditions) {
        const why = impossibleAtom(project, can, x, owner);
        if (why) return why;
      }
      return null;
    case "any": {
      const whys = c.conditions.map((x) => impossibleAtom(project, can, x, owner));
      return whys.every(Boolean) ? whys.join("；") : null;
    }
    default:
      return null;
  }
}

function impossiblePage(project: GameProject, can: Possible, c: PageConditions | undefined, owner: string): string | null {
  if (!c) return null;
  for (const id of c.switches ?? []) if (!can.switchesOn.has(id)) return `開關「${switchName(project, id)}」從來沒有被打開`;
  if (c.itemId && !can.items.has(c.itemId)) return `物品「${itemName(project, c.itemId)}」在遊戲中拿不到`;
  if (c.variable && c.variable.min > (can.varMax.get(c.variable.id) ?? 0)) return `變數「${project.variables.find((v) => v.id === c.variable!.id)?.name ?? c.variable.id}」最大只會到 ${can.varMax.get(c.variable.id) ?? 0}，到不了 ${c.variable.min}`;
  if (c.quest) {
    const why = impossibleAtom(project, can, { type: "quest", questId: c.quest.questId, status: c.quest.status }, owner);
    if (why) return why;
  }
  if (c.selfSwitch && !can.selfOn.get(owner)?.has(c.selfSwitch) && !can.commonSelf.has(c.selfSwitch)) return `獨立開關 ${c.selfSwitch} 從來沒有被這個事件打開`;
  if (c.custom) return impossibleAtom(project, can, c.custom, owner);
  return null;
}

/** 事件頁 j（編號較大）的條件是否「只要 i 成立，j 就一定成立」：成立的話，i 永遠不會被使用 */
function covers(j: PageConditions | undefined, i: PageConditions | undefined) {
  if (!j) return true;
  const ii = i ?? {};
  if ((j.switches ?? []).some((s) => !(ii.switches ?? []).includes(s))) return false;
  if (j.variable && !(ii.variable && ii.variable.id === j.variable.id && ii.variable.min >= j.variable.min)) return false;
  if (j.selfSwitch && ii.selfSwitch !== j.selfSwitch) return false;
  if (j.itemId && ii.itemId !== j.itemId) return false;
  if (j.quest && !(ii.quest && ii.quest.questId === j.quest.questId && ii.quest.status === j.quest.status)) return false;
  if (j.custom && JSON.stringify(j.custom) !== JSON.stringify(ii.custom)) return false;
  return true;
}

/** 從入口點出發，地形走得到的格子（事件一律當作可以通過，只抓地形上的死角） */
function flood(map: MapDefinition, starts: Array<{ x: number; y: number }>) {
  const seen = new Set<string>();
  const queue = starts.filter((s) => isWalkableTile(map, s.x, s.y));
  for (const s of queue) seen.add(`${s.x},${s.y}`);
  while (queue.length) {
    const { x, y } = queue.shift()!;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (!seen.has(k) && isWalkableTile(map, nx, ny)) {
        seen.add(k);
        queue.push({ x: nx, y: ny });
      }
    }
  }
  return seen;
}

const near = (seen: Set<string>, x: number, y: number) => [`${x},${y}`, `${x + 1},${y}`, `${x - 1},${y}`, `${x},${y + 1}`, `${x},${y - 1}`].some((k) => seen.has(k));

/** 這個事件頁玩家碰得到嗎：同層事件站在旁邊就能觸發；腳下／頭上的事件要走到那一格 */
function pageReachable(seen: Set<string>, e: MapEvent, p: EventPage) {
  if (p.trigger === "autorun") return true;
  return p.priority === "same" ? near(seen, e.x, e.y) : seen.has(`${e.x},${e.y}`);
}

const meaningful = (c: EventCommand) => ["transfer", "chapter", "ending", "item", "switch", "quest", "variable"].includes(c.code);
const leaves = (c: EventCommand) => c.code === "transfer" || c.code === "chapter" || c.code === "ending";

export function lintDesign(project: GameProject): LintReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const can = possibilities(project);
  const at = (w: Where) => (w.eventId ? `maps.${w.mapId}.events.${w.eventId}` : `maps.${w.mapId}`);

  // 每張地圖的入口：起點、所有傳送目的地、章節測試起點（下一章推出後玩家從這裡接著玩）
  const entries = new Map<string, Array<{ x: number; y: number; from: string }>>();
  const addEntry = (mapId: string, x: number, y: number, from: string) => entries.set(mapId, [...(entries.get(mapId) ?? []), { x, y, from }]);
  addEntry(project.system.start.mapId, project.system.start.x, project.system.start.y, "遊戲起點");
  for (const ch of project.chapters) if (ch.testStart) addEntry(ch.testStart.mapId, ch.testStart.x, ch.testStart.y, `第「${ch.title}」章的起點`);
  const transfers = (cmds: EventCommand[], from: string) => walk(cmds, (c) => c.code === "transfer" && addEntry(c.mapId, c.x, c.y, from));
  for (const m of project.maps) for (const e of m.events) for (const p of e.pages) transfers(p.commands, `「${m.name}」的「${e.name}」`);
  for (const ce of project.commonEvents) transfers(ce.commands, `共用事件「${ce.name}」`);

  for (const m of project.maps) {
    const mapEntries = entries.get(m.id) ?? [];
    if (mapEntries.length === 0 && m.events.length > 0 && project.cover?.mapId !== m.id) warnings.push({ path: at({ mapId: m.id }), message: `地圖「${m.name}」沒有任何入口（沒有傳送會到這裡），上面的 ${m.events.length} 個事件玩家都看不到` });
    const seen = flood(m, mapEntries);
    const mapAutorun = m.events.some((e) => e.pages.some((p) => p.trigger === "autorun" && contains(project, p.commands, leaves)));

    for (const e of m.events) {
      const w = { mapId: m.id, eventId: e.id };
      const owner = `${m.id}/${e.id}`;
      // L1 被蓋掉的事件頁
      e.pages.forEach((p, i) => {
        const j = e.pages.findIndex((q, k) => k > i && covers(q.conditions, p.conditions));
        if (j > 0) errors.push({ path: at(w), message: `事件「${e.name}」第 ${i + 1} 頁永遠不會被使用：第 ${j + 1} 頁的條件比較寬（或沒有條件），系統一律使用條件成立、編號最大的頁。請把條件比較嚴格的頁放到後面` });
      });
      // L2 條件永遠不成立的事件頁
      e.pages.forEach((p, i) => {
        const why = impossiblePage(project, can, p.conditions, owner);
        if (why) errors.push({ path: at(w), message: `事件「${e.name}」第 ${i + 1} 頁永遠不會出現：${why}` });
      });
      // L3 走不到的事件
      if (mapEntries.length && !e.pages.some((p) => pageReachable(seen, e, p))) {
        const important = e.pages.some((p) => contains(project, p.commands, meaningful));
        (important ? errors : warnings).push({ path: at(w), message: `事件「${e.name}」在 (${e.x},${e.y})，從這張地圖的任何入口都走不到${important ? "（它會推進劇情，玩家會卡關）" : ""}` });
      }
      // L5 按確定鍵卻沒有反應
      e.pages.forEach((p, i) => {
        // 沒有圖像、沒有指令的頁是 RPG Maker 慣用的「事件已結束」寫法，不算問題
        if (p.trigger === "action" && p.graphic && p.commands.every((c) => c.code === "comment")) warnings.push({ path: at(w), message: `事件「${e.name}」第 ${i + 1} 頁按確定鍵沒有任何反應（G2：至少給一句回應）` });
      });
      // 條件分支與選項條件
      e.pages.forEach((p) =>
        walk(p.commands, (c) => {
          if (c.code === "if") {
            const why = impossibleAtom(project, can, c.condition, owner);
            if (why) warnings.push({ path: at(w), message: `事件「${e.name}」有一個條件分支永遠不會成立：${why}` });
          }
          if (c.code === "present" && c.otherwise.length === 0)
            warnings.push({ path: at(w), message: `事件「${e.name}」的出示物品沒有「拿出其他物品時」的回應（玩家拿錯東西時要有一句反應）` });
          if (c.code === "choices")
            c.options.forEach((o) => {
              if (o.commands.length === 0) warnings.push({ path: at(w), message: `事件「${e.name}」的選項「${o.text}」選了沒有任何回應（B4：至少一句專屬回應）` });
              const why = o.condition && impossibleAtom(project, can, o.condition, owner);
              if (why) warnings.push({ path: at(w), message: `事件「${e.name}」的選項「${o.text}」永遠不會出現：${why}` });
            });
        }),
      );
    }

    // L4 困住玩家的區域：每個入口所在的區域，都要有離開的方法
    for (const entry of mapEntries) {
      const region = flood(m, [entry]);
      const exit =
        mapAutorun || m.events.some((e) => e.pages.some((p) => pageReachable(region, e, p) && contains(project, p.commands, leaves))) || project.commonEvents.some((c) => c.trigger === "autorun" && contains(project, c.commands, leaves));
      if (!exit)
        errors.push({
          path: at({ mapId: m.id }),
          message: `從${entry.from}進入「${m.name}」(${entry.x},${entry.y}) 之後，走得到的範圍內沒有任何傳送、章節或結局可以離開，玩家會被困住`,
        });
    }
  }

  // 成就：條件永遠不會成立，玩家永遠解鎖不了
  for (const a of project.achievements ?? []) {
    const why = impossibleAtom(project, can, a.condition);
    if (why) errors.push({ path: `achievements.${a.id}`, message: `成就「${a.title}」永遠無法解鎖：${why}` });
  }

  // L5 任務沒有終點
  for (const q of project.quests) {
    const s = can.questStatus.get(q.id);
    if (s?.has("active") && !s.has("completed") && !s.has("failed")) warnings.push({ path: `quests.${q.id}`, message: `任務「${q.title}」會開始，但沒有任何事件會完成或結束它（C1：每個任務一個終點）` });
  }

  // 同一個入口的重複訊息只留一則
  const uniq = (list: ValidationIssue[]) => list.filter((x, i) => list.findIndex((y) => y.path === x.path && y.message === x.message) === i);
  return { errors: uniq(errors), warnings: uniq(warnings) };
}
