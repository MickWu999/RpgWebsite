import { walkCommands } from "@/game/commands";
import type { EventCommand, GameProject, MapEvent } from "@/game/schema";

/**
 * 兩個版本的差異：讓人快速確認 AI（或其他人）這一版改了什麼。
 * 以「人看得懂的單位」比較：資料庫項目、地圖、事件，以及事件裡的台詞與選項文字。
 */

export type DiffEntry = { change: "added" | "removed" | "changed"; area: string; label: string; details: string[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 事件裡所有的台詞與選項文字（依出現順序） */
function linesOf(commands: EventCommand[]) {
  const out: string[] = [];
  walkCommands(commands, (c) => {
    if (c.code === "text") out.push(c.text);
    if (c.code === "choices") c.options.forEach((o) => out.push(`▸ ${o.text}`));
  });
  return out;
}

function eventDetails(a: MapEvent, b: MapEvent) {
  const details: string[] = [];
  if (a.x !== b.x || a.y !== b.y) details.push(`位置 (${a.x},${a.y}) → (${b.x},${b.y})`);
  if (a.pages.length !== b.pages.length) details.push(`事件頁 ${a.pages.length} → ${b.pages.length} 頁`);
  const before = a.pages.flatMap((p) => linesOf(p.commands));
  const after = b.pages.flatMap((p) => linesOf(p.commands));
  const removed = before.filter((x) => !after.includes(x));
  const added = after.filter((x) => !before.includes(x));
  for (const x of removed.slice(0, 12)) details.push(`－ ${x}`);
  for (const x of added.slice(0, 12)) details.push(`＋ ${x}`);
  if (removed.length + added.length > 24) details.push(`（還有 ${removed.length + added.length - 24} 行文字變動）`);
  const logic = (e: MapEvent) => e.pages.map((p) => ({ ...p, commands: JSON.stringify(p.commands).replace(/"text":"[^"]*"/g, "") }));
  if (!same(logic(a), logic(b))) details.push("出現條件、觸發方式或指令（開關、物品、傳送等）有變動");
  return details;
}

function byId<T extends { id: string }>(area: string, a: T[], b: T[], label: (x: T) => string, out: DiffEntry[]) {
  for (const x of b) {
    const old = a.find((y) => y.id === x.id);
    if (!old) out.push({ change: "added", area, label: label(x), details: [] });
    else if (!same(old, x)) out.push({ change: "changed", area, label: label(x), details: [] });
  }
  for (const x of a) if (!b.some((y) => y.id === x.id)) out.push({ change: "removed", area, label: label(x), details: [] });
}

export function diffProjects(a: GameProject, b: GameProject): DiffEntry[] {
  const out: DiffEntry[] = [];
  const meta: string[] = [];
  if (a.title !== b.title) meta.push(`標題「${a.title}」→「${b.title}」`);
  if (a.description !== b.description) meta.push("簡介有變動");
  if ((a.intro ?? "") !== (b.intro ?? "")) meta.push("開場文字有變動");
  if (!same(a.release, b.release)) meta.push(`推出方式 ${a.release?.status ?? "complete"} → ${b.release?.status ?? "complete"}`);
  if (!same(a.system, b.system)) meta.push("系統設定（起點、主角、初始物品）有變動");
  if (!same(a.cover, b.cover)) meta.push("封面有變動");
  if (meta.length) out.push({ change: "changed", area: "遊戲資訊", label: b.title, details: meta });

  byId("章節", a.chapters, b.chapters, (x) => x.title, out);
  byId("角色", a.actors, b.actors, (x) => x.name, out);
  byId("物品", a.items, b.items, (x) => x.name, out);
  byId("任務", a.quests, b.quests, (x) => x.title, out);
  byId("結局", a.endings, b.endings, (x) => x.title, out);
  byId("開關", a.switches, b.switches, (x) => x.name, out);
  byId("變數", a.variables, b.variables, (x) => x.name, out);
  byId("共用事件", a.commonEvents, b.commonEvents, (x) => x.name, out);

  for (const m of b.maps) {
    const old = a.maps.find((x) => x.id === m.id);
    if (!old) {
      out.push({ change: "added", area: "地圖", label: m.name, details: [`${m.width}×${m.height}，${m.events.length} 個事件`] });
      continue;
    }
    const mapDetails: string[] = [];
    if (old.name !== m.name) mapDetails.push(`名稱「${old.name}」→「${m.name}」`);
    if (!same(old.terrain, m.terrain)) mapDetails.push("地形有變動");
    if (old.music !== m.music) mapDetails.push(`音樂 ${old.music ?? "預設"} → ${m.music ?? "預設"}`);
    if (mapDetails.length) out.push({ change: "changed", area: "地圖", label: m.name, details: mapDetails });
    for (const e of m.events) {
      const prev = old.events.find((x) => x.id === e.id);
      if (!prev) out.push({ change: "added", area: "事件", label: `${m.name}／${e.name}`, details: e.pages.flatMap((p) => linesOf(p.commands)).slice(0, 6).map((x) => `＋ ${x}`) });
      else if (!same(prev, e)) out.push({ change: "changed", area: "事件", label: `${m.name}／${e.name}`, details: eventDetails(prev, e) });
    }
    for (const e of old.events) if (!m.events.some((x) => x.id === e.id)) out.push({ change: "removed", area: "事件", label: `${m.name}／${e.name}`, details: [] });
  }
  for (const m of a.maps) if (!b.maps.some((x) => x.id === m.id)) out.push({ change: "removed", area: "地圖", label: m.name, details: [] });
  return out;
}
