import { canPass, eventsAt, visibleEvents, type PlayerState } from "./engine";
import type { Direction, EventPage, GameProject, MapEvent } from "./schema";

const STEPS: Array<[Direction, number, number]> = [
  ["up", 0, -1],
  ["down", 0, 1],
  ["left", -1, 0],
  ["right", 1, 0],
];

/**
 * 地圖內 BFS 尋路（與 engine.move 的規則一致）。
 * 路上會避開「接觸觸發、在角色下／上」的事件格（例如場所移動、觸發區），以免走過去時意外觸發。
 * 回傳方向序列；走不到時回傳 null。
 */
export function findPath(project: GameProject, state: PlayerState, isGoal: (x: number, y: number) => boolean): Direction[] | null {
  if (isGoal(state.x, state.y)) return [];
  const traps = new Set(
    visibleEvents(project, state)
      .filter((v) => v.page.trigger === "touch" && v.page.priority !== "same")
      .map((v) => `${v.event.x},${v.event.y}`),
  );
  const prev = new Map<string, { from: string; dir: Direction } | null>([[`${state.x},${state.y}`, null]]);
  const queue: Array<[number, number]> = [[state.x, state.y]];
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const [dir, dx, dy] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      const k = `${nx},${ny}`;
      if (prev.has(k) || !canPass(project, state, nx, ny)) continue;
      prev.set(k, { from: `${x},${y}`, dir });
      if (isGoal(nx, ny)) {
        const path: Direction[] = [];
        for (let cur: string | undefined = k; cur && prev.get(cur); cur = prev.get(cur)!.from) path.unshift(prev.get(cur)!.dir);
        return path;
      }
      if (!traps.has(k)) queue.push([nx, ny]);
    }
  }
  return null;
}

function endOf(state: PlayerState, path: Direction[]) {
  let { x, y } = state;
  for (const dir of path) {
    const [, dx, dy] = STEPS.find((s) => s[0] === dir)!;
    x += dx;
    y += dy;
  }
  return { x, y };
}

/** 走到某格正前方並面向它（最後一步「朝它走」只會轉向） */
export function pathToFace(project: GameProject, state: PlayerState, tx: number, ty: number): Direction[] | null {
  const path = findPath(project, state, (x, y) => Math.abs(x - tx) + Math.abs(y - ty) === 1);
  if (!path) return null;
  const { x, y } = endOf(state, path);
  return [...path, STEPS.find(([, dx, dy]) => x + dx === tx && y + dy === ty)![0]];
}

/**
 * 走去觸發事件所需的方向序列：
 * - 同層事件：走到旁邊並面向它（接觸觸發的會在最後一步「撞到」時觸發）。
 * - 在角色下／上的事件：走到它那一格（接觸觸發的會在踩上去時觸發）。
 */
export function pathToEvent(project: GameProject, state: PlayerState, event: MapEvent, page: EventPage): Direction[] | null {
  if (page.priority !== "same") return findPath(project, state, (x, y) => x === event.x && y === event.y);
  return pathToFace(project, state, event.x, event.y);
}

/** 點擊地圖：點到事件就走過去觸發；點到地面就走過去 */
export function pathToTile(project: GameProject, state: PlayerState, x: number, y: number): { moves: Direction[]; confirm: boolean } | null {
  const target = eventsAt(project, state, x, y).find((v) => v.page.trigger === "action" || v.page.priority === "same");
  if (target) {
    const moves = pathToEvent(project, state, target.event, target.page);
    return moves ? { moves, confirm: target.page.trigger === "action" } : null;
  }
  const moves = findPath(project, state, (px, py) => px === x && py === y);
  return moves ? { moves, confirm: false } : null;
}
