import { canMoveTo, getScene, type Direction, type PlayerState } from "./engine";
import type { GameProject } from "./schema";

const STEPS: Array<[Direction, number, number]> = [
  ["up", 0, -1],
  ["down", 0, 1],
  ["left", -1, 0],
  ["right", 1, 0],
];

/**
 * 跨場景 BFS 尋路（與 engine.move 的規則一致：踩到出口會傳送）。
 * 回傳從目前位置到第一個符合 isGoal 的格子的方向序列；走不到時回傳 null。
 */
export function findPath(
  project: GameProject,
  state: Pick<PlayerState, "sceneId" | "x" | "y">,
  isGoal: (sceneId: string, x: number, y: number) => boolean,
): Direction[] | null {
  const key = (s: string, x: number, y: number) => `${s}:${x},${y}`;
  const startKey = key(state.sceneId, state.x, state.y);
  if (isGoal(state.sceneId, state.x, state.y)) return [];
  const prev = new Map<string, { from: string; dir: Direction } | null>([[startKey, null]]);
  const queue: Array<[string, number, number]> = [[state.sceneId, state.x, state.y]];

  while (queue.length > 0) {
    const [sid, x, y] = queue.shift()!;
    const here = key(sid, x, y);
    for (const [dir, dx, dy] of STEPS) {
      let nsid = sid;
      let nx = x + dx;
      let ny = y + dy;
      if (!canMoveTo(project, sid, nx, ny)) continue;
      const exit = getScene(project, sid).exits.find((e) => e.x === nx && e.y === ny);
      if (exit) {
        nsid = exit.targetSceneId;
        nx = exit.targetX;
        ny = exit.targetY;
      }
      const k = key(nsid, nx, ny);
      if (prev.has(k)) continue;
      prev.set(k, { from: here, dir });
      if (isGoal(nsid, nx, ny)) {
        const path: Direction[] = [];
        let cur: string | undefined = k;
        while (cur && prev.get(cur)) {
          const step: { from: string; dir: Direction } = prev.get(cur)!;
          path.unshift(step.dir);
          cur = step.from;
        }
        return path;
      }
      queue.push([nsid, nx, ny]);
    }
  }
  return null;
}

/** 走到 NPC 正旁邊並面向它所需的方向序列（最後一步是「撞向 NPC」以轉向） */
export function pathToNpc(project: GameProject, state: PlayerState, npcId: string): Direction[] | null {
  const npc = project.npcs.find((n) => n.id === npcId);
  if (!npc) return null;
  const { x: nx, y: ny } = npc.position;
  const path = findPath(project, state, (s, x, y) => s === npc.sceneId && Math.abs(x - nx) + Math.abs(y - ny) === 1);
  if (!path) return null;
  // 推算終點以決定面向
  let { sceneId, x, y } = state;
  for (const dir of path) {
    const [, dx, dy] = STEPS.find((s) => s[0] === dir)!;
    x += dx;
    y += dy;
    const exit = getScene(project, sceneId).exits.find((e) => e.x === x && e.y === y);
    if (exit) ({ targetSceneId: sceneId, targetX: x, targetY: y } = exit);
  }
  const face = STEPS.find(([, dx, dy]) => x + dx === nx && y + dy === ny)![0];
  return [...path, face];
}
