import { allSources, resolveList, sourceKey, sourceRoot, walkProject, type CommandPath, type CommandSource } from "./commands";
import type { PlayerState } from "./engine";
import type { EventCommand, GameProject } from "./schema";

/**
 * 位置代碼與引用查詢：讓人和 AI 用同一個代碼指到「哪一句台詞、哪一個事件頁」。
 *
 * 位置代碼：`<地圖ID>/<事件ID>/p<頁>#<指令路徑>`，例如 `town/mira/p2#3.then.0`
 * ＝城鎮地圖、事件 mira、第 2 頁、第 3 個指令（條件分支）的「成立時」裡的第 0 個指令。
 * 共用事件是 `common/<ID>#<指令路徑>`；只指到事件頁時省略 `#…`；開場文字（project.intro）是 `intro`。
 * 測試遊玩的「📌 標記」、修改清單、`npm run game -- refs` 都用這個格式。
 */

export function locatorOf(source: CommandSource, path: CommandPath = [], index?: number) {
  const tail = index === undefined ? path : [...path, index];
  return tail.length ? `${sourceKey(source)}#${tail.join(".")}` : sourceKey(source);
}

/** 解析位置代碼 */
export function parseLocator(locator: string): { source: CommandSource; path: CommandPath; index?: number } | null {
  const [head, tail] = locator.trim().split("#");
  const parts = head.split("/");
  let source: CommandSource;
  if (parts[0] === "common" && parts.length === 2) source = { kind: "common", id: parts[1] };
  else if (parts.length === 3 && /^p\d+$/.test(parts[2])) source = { kind: "event", mapId: parts[0], eventId: parts[1], page: Number(parts[2].slice(1)) - 1 };
  else return null;
  if (!tail) return { source, path: [] };
  const segs = tail.split(".").map((x) => (x === "then" || x === "else" ? x : Number(x)));
  if (segs.some((x) => typeof x === "number" && Number.isNaN(x))) return null;
  const index = segs.pop() as number;
  return { source, path: segs as CommandPath, index };
}

/** 測試遊玩當下的位置：正在執行的事件指令；沒有在執行事件時回傳 null */
export function currentLocator(project: GameProject, state: PlayerState): string | null {
  const frame = state.interpreter?.frames.at(-1);
  if (!frame) return null;
  let index = Math.max(0, frame.index - 1);
  // 「台詞後面緊接著選項」會合成一個畫面，執行位置停在選項上；改成指回那句台詞
  const root = sourceRoot(project, frame.source);
  const list = root ? resolveList(root, frame.path) : null;
  if (list?.[index]?.code === "choices" && list[index - 1]?.code === "text" && state.message?.kind === "text" && state.message.text) index--;
  return locatorOf(frame.source, frame.path, index);
}

/** 位置代碼指到的指令（或事件頁的第一個指令）；找不到回傳 null */
export function commandAt(project: GameProject, locator: string): { command: EventCommand | null; label: string } | null {
  if (locator === "intro") return { command: null, label: "開場文字（project.intro，用 project.update 修改）" };
  const loc = parseLocator(locator);
  if (!loc) return null;
  const entry = allSources(project).find((s) => sourceKey(s.source) === sourceKey(loc.source));
  if (!entry) return null;
  if (loc.index === undefined) return { command: null, label: entry.label };
  const list = resolveList(entry.commands, loc.path);
  return { command: list?.[loc.index] ?? null, label: entry.label };
}

export type RefHit = { locator: string; label: string; what: string };

const ID_FIELDS = ["id", "ids", "itemId", "questId", "actorId", "mapId", "endingId", "chapterId", "switchId", "switches"];

/** 這段資料有沒有引用某個 ID（只看 ID 欄位，不會被台詞內容誤判） */
function mentions(value: unknown, id: string): boolean {
  if (Array.isArray(value)) return value.some((v) => mentions(v, id));
  if (!value || typeof value !== "object") return false;
  for (const [k, v] of Object.entries(value)) {
    if (k === "then" || k === "else" || k === "commands") continue;
    if (ID_FIELDS.includes(k) && (v === id || (Array.isArray(v) && v.includes(id)))) return true;
    if (typeof v === "object" && mentions(v, id)) return true;
  }
  return false;
}

const short = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

/**
 * 找出所有引用某個 ID（開關、變數、物品、任務、角色、地圖、結局、章節、共用事件）的地方；
 * 查詢字串不是 ID 時，改成搜尋台詞與選項文字。
 */
export function findRefs(project: GameProject, query: string): RefHit[] {
  const hits: RefHit[] = [];
  const q = query.trim();
  if (!q) return hits;
  // 事件頁的出現條件
  for (const m of project.maps)
    for (const e of m.events) {
      if (e.id === q) hits.push({ locator: `${m.id}/${e.id}/p1`, label: `${m.name}／${e.name}`, what: `事件本身（${e.pages.length} 頁）` });
      e.pages.forEach((p, page) => {
        if (p.conditions && mentions(p.conditions, q)) hits.push({ locator: locatorOf({ kind: "event", mapId: m.id, eventId: e.id, page }), label: `${m.name}／${e.name}（第 ${page + 1} 頁）`, what: "出現條件" });
        if (p.graphic?.assetId === q) hits.push({ locator: locatorOf({ kind: "event", mapId: m.id, eventId: e.id, page }), label: `${m.name}／${e.name}（第 ${page + 1} 頁）`, what: "圖像" });
      });
    }
  // 指令（含條件分支、選項條件）
  walkProject(project, (cmd, ctx) => {
    const at = locatorOf(ctx.source, ctx.path, ctx.index);
    if (mentions(cmd, q) || (cmd.code === "common" && cmd.id === q)) hits.push({ locator: at, label: ctx.label, what: `指令 ${cmd.code}` });
    if (cmd.code === "text" && cmd.text.includes(q)) hits.push({ locator: at, label: ctx.label, what: `台詞：「${short(cmd.text)}」` });
    if (cmd.code === "choices") cmd.options.forEach((o, i) => o.text.includes(q) && hits.push({ locator: at, label: ctx.label, what: `選項 ${i + 1}：「${short(o.text)}」` }));
  });
  // 結局的尾聲條件、章節測試起點、系統設定
  for (const e of project.endings) {
    if (e.id === q) hits.push({ locator: `endings/${e.id}`, label: `結局「${e.title}」`, what: "結局本身" });
    (e.epilogues ?? []).forEach((x, i) => mentions(x.condition, q) && hits.push({ locator: `endings/${e.id}`, label: `結局「${e.title}」`, what: `尾聲 ${i + 1} 的條件` }));
    if (e.text.includes(q) && q.length >= 2) hits.push({ locator: `endings/${e.id}`, label: `結局「${e.title}」`, what: `結局文字` });
  }
  for (const c of project.chapters) if (c.testStart && mentions(c.testStart, q)) hits.push({ locator: `chapters/${c.id}`, label: `章節「${c.title}」`, what: "測試起點" });
  if (project.system.start.mapId === q || project.system.playerActorId === q || project.system.initialItems.some((i) => i.itemId === q)) hits.push({ locator: "system", label: "系統設定", what: "起點／主角／初始物品" });
  return hits.filter((h, i) => hits.findIndex((x) => x.locator === h.locator && x.what === h.what) === i);
}
