import {
  availableChoices,
  choose,
  closeDialogue,
  createInitialState,
  currentDialogueNode,
  interact,
  move,
  visiblePickups,
  type Direction,
  type PlayerState,
} from "./engine";
import { findPath, pathToFace, pathToNpc } from "./pathfinding";
import type { GameProject } from "./schema";
import type { ValidationIssue } from "./validate";

/**
 * 自動試玩（headless playtest）：不經過瀏覽器，直接用遊戲引擎窮舉所有行動，
 * 證明每個結局都真的玩得到，並找出「卡死」狀態（玩家再也無法到達任何結局）。
 * 行動以「目標」為單位：找某位 NPC 對話、走去撿取物、走進地點、選擇對話選項。
 * 狀態去重時忽略玩家座標，所以這是近似但足夠實用的完整性檢查。
 */

export type PlaytestAction =
  | { kind: "talk"; npcId: string; moves: Direction[] }
  | { kind: "pickup"; pickupId: string; moves: Direction[] }
  | { kind: "location"; locationId: string; moves: Direction[] }
  | { kind: "inspect"; interactableId: string; moves: Direction[] }
  | { kind: "choose"; choiceId: string }
  | { kind: "close" };

export type EndingResult = {
  endingId: string;
  title: string;
  reachable: boolean;
  /** 最短行動路線（人類可讀） */
  steps?: string[];
  /** 對應的實際按鍵／選項序列，可重播 */
  actions?: PlaytestAction[];
};

export type PlaytestReport = {
  ok: boolean;
  statesExplored: number;
  truncated: boolean;
  endings: EndingResult[];
  softlocks: Array<{ steps: string[] }>;
  issues: ValidationIssue[];
};

type Node = { state: PlayerState; parent: number; action: PlaytestAction | null; children: number[] };

function stateKey(s: PlayerState) {
  return JSON.stringify([s.sceneId, s.flags, s.inventory, s.quests, [...s.collectedPickups].sort(), s.dialogue, s.endingId]);
}

/** 依序執行行動；可用於重播自動試玩找到的路線 */
export function applyAction(project: GameProject, input: PlayerState, action: PlaytestAction): PlayerState {
  let state = input;
  switch (action.kind) {
    case "choose":
      return choose(project, state, action.choiceId).state;
    case "close":
      return closeDialogue(project, state).state;
    default:
      for (const dir of action.moves) {
        if (state.endingId) return state;
        state = move(project, state, dir).state;
      }
      return (action.kind === "talk" || action.kind === "inspect") && !state.endingId ? interact(project, state).state : state;
  }
}

function describe(project: GameProject, state: PlayerState, action: PlaytestAction): string {
  switch (action.kind) {
    case "talk":
      return `找「${project.npcs.find((n) => n.id === action.npcId)?.name}」對話`;
    case "pickup": {
      const pickup = project.scenes.flatMap((s) => s.pickups ?? []).find((p) => p.id === action.pickupId);
      return `撿起「${project.items.find((i) => i.id === pickup?.itemId)?.name ?? pickup?.itemId}」`;
    }
    case "location":
      return `前往「${project.scenes.flatMap((s) => s.locations ?? []).find((l) => l.id === action.locationId)?.name}」`;
    case "inspect":
      return `調查「${project.scenes.flatMap((s) => s.interactables ?? []).find((o) => o.id === action.interactableId)?.name}」`;
    case "choose": {
      const choice = availableChoices(project, state).find((c) => c.id === action.choiceId);
      return `選擇「${choice?.text ?? action.choiceId}」`;
    }
    case "close":
      return `結束對話（${currentDialogueNode(project, state)?.speaker ?? ""}）`;
  }
}

function candidateActions(project: GameProject, state: PlayerState): PlaytestAction[] {
  if (state.endingId) return [];
  if (state.dialogue) {
    const choices = availableChoices(project, state);
    return choices.length > 0 ? choices.map((c) => ({ kind: "choose", choiceId: c.id })) : [{ kind: "close" }];
  }
  const actions: PlaytestAction[] = [];
  for (const npc of project.npcs) {
    const moves = pathToNpc(project, state, npc.id);
    if (moves) actions.push({ kind: "talk", npcId: npc.id, moves });
  }
  for (const scene of project.scenes) {
    for (const o of scene.interactables ?? []) {
      const moves = pathToFace(project, state, scene.id, o.x, o.y);
      if (moves) actions.push({ kind: "inspect", interactableId: o.id, moves });
    }
    for (const pickup of visiblePickups(project, state, scene.id)) {
      const moves = findPath(project, state, (s, x, y) => s === scene.id && x === pickup.x && y === pickup.y);
      if (moves) actions.push({ kind: "pickup", pickupId: pickup.id, moves });
    }
    for (const loc of scene.locations ?? []) {
      const inside = (s: string, x: number, y: number) =>
        s === scene.id && x >= loc.x && x < loc.x + (loc.width ?? 1) && y >= loc.y && y < loc.y + (loc.height ?? 1);
      if (inside(state.sceneId, state.x, state.y)) continue;
      const moves = findPath(project, state, inside);
      if (moves) actions.push({ kind: "location", locationId: loc.id, moves });
    }
  }
  return actions;
}

export function runPlaytest(project: GameProject, options: { maxStates?: number } = {}): PlaytestReport {
  // 中型遊戲約 1 萬個狀態、0.5 秒內可探索完；上限設高一點，避免卡死偵測被截斷
  const maxStates = options.maxStates ?? 30000;
  const nodes: Node[] = [{ state: createInitialState(project), parent: -1, action: null, children: [] }];
  const index = new Map<string, number>([[stateKey(nodes[0].state), 0]]);
  const firstEnding = new Map<string, number>();
  let truncated = false;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.state.endingId) {
      if (!firstEnding.has(node.state.endingId)) firstEnding.set(node.state.endingId, i);
      continue;
    }
    for (const action of candidateActions(project, node.state)) {
      const next = applyAction(project, node.state, action);
      const key = stateKey(next);
      let child = index.get(key);
      if (child === undefined) {
        if (nodes.length >= maxStates) {
          truncated = true;
          continue;
        }
        child = nodes.length;
        nodes.push({ state: next, parent: i, action, children: [] });
        index.set(key, child);
      }
      if (child !== i) node.children.push(child);
    }
  }

  const trace = (i: number) => {
    const chain: number[] = [];
    for (let cur = i; cur > 0; cur = nodes[cur].parent) chain.unshift(cur);
    return {
      steps: chain.map((c) => describe(project, nodes[nodes[c].parent].state, nodes[c].action!)),
      actions: chain.map((c) => nodes[c].action!),
    };
  };

  // 反向搜尋：哪些狀態還能走到任一結局
  const parents = nodes.map(() => [] as number[]);
  nodes.forEach((n, i) => n.children.forEach((c) => parents[c].push(i)));
  const canFinish = new Set<number>();
  const stack = [...firstEnding.values()];
  nodes.forEach((n, i) => n.state.endingId && stack.push(i));
  while (stack.length) {
    const i = stack.pop()!;
    if (canFinish.has(i)) continue;
    canFinish.add(i);
    parents[i].forEach((p) => stack.push(p));
  }

  const endings: EndingResult[] = project.endings.map((e) => {
    const at = firstEnding.get(e.id);
    return at === undefined ? { endingId: e.id, title: e.title, reachable: false } : { endingId: e.id, title: e.title, reachable: true, ...trace(at) };
  });
  const softlockNodes = truncated ? [] : nodes.map((_, i) => i).filter((i) => !canFinish.has(i));
  const softlocks = softlockNodes.slice(0, 3).map((i) => ({ steps: trace(i).steps }));

  const issues: ValidationIssue[] = [];
  endings.forEach((e, i) => {
    if (!e.reachable) issues.push({ path: `endings[${i}]`, message: `自動試玩${truncated ? `（探索 ${maxStates} 個狀態後截斷）` : ""}找不到能達成結局「${e.title}」的路線` });
  });
  if (softlockNodes.length > 0) {
    issues.push({
      path: "playtest",
      message: `自動試玩發現 ${softlockNodes.length} 個卡死狀態（之後無論怎麼玩都到不了結局），例如：${softlocks[0].steps.join(" → ")}`,
    });
  }
  // 截斷時只要每個結局都找得到路線就算可玩；卡死偵測不完整這件事由 truncated 明確標示
  return {
    ok: issues.length === 0,
    statesExplored: nodes.length,
    truncated,
    endings,
    softlocks,
    issues,
  };
}
