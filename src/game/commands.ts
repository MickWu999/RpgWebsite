import type { EventCommand, EventPage, GameCondition, GameProject } from "./schema";

/**
 * 事件指令樹的共用工具：定位巢狀指令列、走訪所有指令、列出專案中所有的指令來源。
 *
 * 指令列的位置用 path 表示：每兩個元素一組 [指令索引, 分支]，分支是 "then"／"else"（條件分支）或選項編號（顯示選項）。
 * 例如 [3, "then", 0, 1] ＝ 第 3 個指令（條件分支）的「成立時」裡，第 0 個指令（顯示選項）的第 1 個選項。
 */

export type Branch = "then" | "else" | number;
export type CommandPath = Array<number | Branch>;

export type CommandSource =
  | { kind: "event"; mapId: string; eventId: string; page: number }
  | { kind: "common"; id: string };

export function sourceKey(s: CommandSource) {
  return s.kind === "event" ? `${s.mapId}/${s.eventId}/p${s.page + 1}` : `common/${s.id}`;
}

export function sourceRoot(project: GameProject, s: CommandSource): EventCommand[] | null {
  if (s.kind === "common") return project.commonEvents.find((c) => c.id === s.id)?.commands ?? null;
  const ev = project.maps.find((m) => m.id === s.mapId)?.events.find((e) => e.id === s.eventId);
  return ev?.pages[s.page]?.commands ?? null;
}

export function branchList(cmd: EventCommand, branch: Branch): EventCommand[] | null {
  if (cmd.code === "if") return branch === "then" ? cmd.then : branch === "else" ? (cmd.else ?? []) : null;
  if (cmd.code === "choices" && typeof branch === "number") return cmd.options[branch]?.commands ?? null;
  return null;
}

/** 依 path 取出巢狀指令列；path 失效（例如專案被修改）時回傳 null */
export function resolveList(root: EventCommand[], path: CommandPath): EventCommand[] | null {
  let list: EventCommand[] | null = root;
  for (let i = 0; i < path.length; i += 2) {
    const cmd: EventCommand | undefined = list?.[path[i] as number];
    if (!cmd) return null;
    list = branchList(cmd, path[i + 1] as Branch);
    if (!list) return null;
  }
  return list;
}

export type WalkContext = {
  path: CommandPath;
  index: number;
  /** 外層的條件分支／選項（由外到內） */
  ancestors: Array<{ cmd: EventCommand; branch: Branch }>;
};

/** 深度優先走訪所有指令（含巢狀） */
export function walkCommands(list: EventCommand[], visit: (cmd: EventCommand, ctx: WalkContext) => void, ctx: Omit<WalkContext, "index"> = { path: [], ancestors: [] }) {
  list.forEach((cmd, index) => {
    visit(cmd, { ...ctx, index });
    const branches: Branch[] = cmd.code === "if" ? ["then", "else"] : cmd.code === "choices" ? cmd.options.map((_, i) => i) : [];
    for (const b of branches) {
      const sub = branchList(cmd, b);
      if (sub) walkCommands(sub, visit, { path: [...ctx.path, index, b], ancestors: [...ctx.ancestors, { cmd, branch: b }] });
    }
  });
}

/** 專案中所有的指令來源（每個事件頁、每個共用事件） */
export type SourceEntry = { source: CommandSource; commands: EventCommand[]; label: string; page?: EventPage };

export function allSources(project: GameProject): SourceEntry[] {
  const out: SourceEntry[] = [];
  for (const m of project.maps)
    for (const e of m.events)
      e.pages.forEach((p, page) => out.push({ source: { kind: "event", mapId: m.id, eventId: e.id, page }, commands: p.commands, label: `${m.name}／${e.name}（第 ${page + 1} 頁）`, page: p }));
  for (const c of project.commonEvents) out.push({ source: { kind: "common", id: c.id }, commands: c.commands, label: `共用事件「${c.name}」` });
  return out;
}

/** 走訪整個專案的所有指令 */
export function walkProject(project: GameProject, visit: (cmd: EventCommand, ctx: WalkContext & { source: CommandSource; label: string }) => void) {
  for (const s of allSources(project)) walkCommands(s.commands, (cmd, ctx) => visit(cmd, { ...ctx, source: s.source, label: s.label }));
}

/** 走訪條件樹的每個原子條件 */
export function walkCondition(c: GameCondition | undefined, visit: (atom: GameCondition) => void) {
  if (!c) return;
  if (c.type === "all" || c.type === "any") c.conditions.forEach((x) => walkCondition(x, visit));
  else if (c.type === "not") walkCondition(c.condition, visit);
  else visit(c);
}

export function conditionAtoms(c: GameCondition): number {
  let n = 0;
  walkCondition(c, () => n++);
  return n;
}

/** 專案中所有的條件（事件頁出現條件、條件分支、選項條件、尾聲），轉成統一的條件格式 */
export function allConditions(project: GameProject): GameCondition[] {
  const out: GameCondition[] = [];
  for (const m of project.maps)
    for (const e of m.events)
      for (const p of e.pages) {
        const c = p.conditions;
        if (!c) continue;
        c.switches?.forEach((id) => out.push({ type: "switch", id, value: true }));
        if (c.variable) out.push({ type: "variable", id: c.variable.id, op: ">=", value: c.variable.min });
        if (c.selfSwitch) out.push({ type: "selfSwitch", key: c.selfSwitch, value: true });
        if (c.itemId) out.push({ type: "item", itemId: c.itemId });
        if (c.quest) out.push({ type: "quest", questId: c.quest.questId, status: c.quest.status });
        if (c.custom) out.push(c.custom);
      }
  walkProject(project, (cmd) => {
    if (cmd.code === "if") out.push(cmd.condition);
    if (cmd.code === "choices") cmd.options.forEach((o) => o.condition && out.push(o.condition));
  });
  project.endings.forEach((e) => e.epilogues?.forEach((x) => out.push(x.condition)));
  return out;
}
