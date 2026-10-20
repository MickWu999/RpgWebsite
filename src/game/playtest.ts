import { advance, choose, confirm, createInitialState, EngineError, evaluateCondition, isBusy, move, visibleEvents, type PlayerState } from "./engine";
import { pathToEvent } from "./pathfinding";
import type { Direction, GameCondition, GameProject } from "./schema";
import type { ValidationIssue } from "./validate";

/**
 * 自動試玩（headless playtest）：不經過瀏覽器，直接用遊戲引擎窮舉玩家可以做的事，
 * 證明每個目標（預設是每個結局）都真的玩得到，並找出「卡死」狀態（之後無論怎麼玩都到不了任何目標）。
 * 行動單位：走去觸發地圖上的某個事件、選擇選項、讓文字繼續。
 * 狀態去重時忽略玩家座標與步數，所以這是近似但足夠實用的完整性檢查。
 */

export type PlaytestAction =
  | { kind: "event"; eventId: string; trigger: "action" | "touch"; moves: Direction[] }
  | { kind: "choose"; index: number }
  | { kind: "advance" };

export type PlaytestGoal = { id: string; title: string; reached: (s: PlayerState) => boolean };

export type GoalResult = {
  id: string;
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
  goals: GoalResult[];
  softlocks: Array<{ steps: string[] }>;
  issues: ValidationIssue[];
};

type Node = { state: PlayerState; parent: number; action: PlaytestAction | null; children: number[] };

function stateKey(s: PlayerState) {
  return JSON.stringify([s.mapId, s.switches, s.variables, s.selfSwitches, s.items, s.quests, s.erased, s.chapterId, s.interpreter, s.message, s.endingId]);
}

/** 依序執行行動；也用來重播自動試玩找到的路線 */
export function applyAction(project: GameProject, input: PlayerState, action: PlaytestAction): PlayerState {
  if (action.kind === "choose") return choose(project, input, action.index).state;
  if (action.kind === "advance") return advance(project, input).state;
  let state = input;
  for (const dir of action.moves) {
    state = move(project, state, dir).state;
    if (isBusy(state)) return state;
  }
  return action.trigger === "action" ? confirm(project, state).state : state;
}

function describe(project: GameProject, state: PlayerState, action: PlaytestAction): string {
  switch (action.kind) {
    case "event": {
      const name = project.maps.find((m) => m.id === state.mapId)?.events.find((e) => e.id === action.eventId)?.name ?? action.eventId;
      return action.trigger === "action" ? `調查／對話「${name}」` : `走到「${name}」`;
    }
    case "choose": {
      const msg = state.message;
      const text = msg?.kind === "text" ? msg.choices?.find((c) => c.index === action.index)?.text : undefined;
      return `選擇「${text ?? action.index}」`;
    }
    case "advance":
      return "繼續";
  }
}

function candidateActions(project: GameProject, state: PlayerState): PlaytestAction[] {
  if (state.endingId) return [];
  const msg = state.message;
  if (msg) return msg.kind === "text" && msg.choices ? msg.choices.map((c) => ({ kind: "choose", index: c.index })) : [{ kind: "advance" }];
  if (state.interpreter) return [];
  const actions: PlaytestAction[] = [];
  for (const v of visibleEvents(project, state)) {
    if (v.page.trigger === "autorun" || v.page.commands.length === 0) continue;
    const moves = pathToEvent(project, state, v.event, v.page);
    if (moves) actions.push({ kind: "event", eventId: v.event.id, trigger: v.page.trigger, moves });
  }
  return actions;
}

export function endingGoals(project: GameProject): PlaytestGoal[] {
  return project.endings.map((e) => ({ id: e.id, title: e.title, reached: (s) => s.endingId === e.id }));
}

/** 狀態條件型目標（例如「章節結束」：某個開關打開） */
export function conditionGoal(id: string, title: string, condition: GameCondition): PlaytestGoal {
  return { id, title, reached: (s) => !isBusy(s) && evaluateCondition(s, condition) };
}

export function runPlaytest(
  project: GameProject,
  options: { maxStates?: number; targetedBudget?: number; start?: PlayerState; goals?: PlaytestGoal[] } = {},
): PlaytestReport {
  const maxStates = options.maxStates ?? 30000;
  const goals = options.goals ?? endingGoals(project);
  const issues: ValidationIssue[] = [];
  const engineErrors = new Map<string, string[]>();
  let start: PlayerState;
  try {
    start = options.start ?? createInitialState(project);
  } catch (e) {
    return { ok: false, statesExplored: 0, truncated: false, goals: goals.map((g) => ({ id: g.id, title: g.title, reachable: false })), softlocks: [], issues: [{ path: "playtest", message: `遊戲一開始就發生錯誤：${(e as Error).message}` }] };
  }
  const nodes: Node[] = [{ state: start, parent: -1, action: null, children: [] }];
  const index = new Map<string, number>([[stateKey(start), 0]]);
  const firstGoal = new Map<string, number>();
  const terminal = (s: PlayerState) => Boolean(s.endingId) || goals.some((g) => g.reached(s));
  let truncated = false;

  const trace = (i: number) => {
    const chain: number[] = [];
    for (let cur = i; cur > 0; cur = nodes[cur].parent) chain.unshift(cur);
    return { steps: chain.map((c) => describe(project, nodes[nodes[c].parent].state, nodes[c].action!)), actions: chain.map((c) => nodes[c].action!) };
  };

  const expand = (i: number, onChild: (child: number, isNew: boolean) => void, limit = maxStates) => {
    const node = nodes[i];
    for (const action of candidateActions(project, node.state)) {
      let next: PlayerState;
      try {
        next = applyAction(project, node.state, action);
      } catch (e) {
        if (!(e instanceof EngineError)) throw e;
        if (!engineErrors.has(e.message)) engineErrors.set(e.message, [...trace(i).steps, describe(project, node.state, action)]);
        continue;
      }
      const key = stateKey(next);
      let child = index.get(key);
      const isNew = child === undefined;
      if (isNew) {
        if (nodes.length >= limit) {
          truncated = true;
          continue;
        }
        child = nodes.length;
        nodes.push({ state: next, parent: i, action, children: [] });
        index.set(key, child);
      }
      if (child !== i && !node.children.includes(child!)) node.children.push(child!);
      onChild(child!, isNew);
    }
  };

  for (let i = 0; i < nodes.length; i++) {
    const s = nodes[i].state;
    const reached = goals.filter((g) => g.reached(s));
    reached.forEach((g) => firstGoal.has(g.id) || firstGoal.set(g.id, i));
    if (terminal(s)) continue;
    expand(i, () => {});
  }

  // 大型遊戲的狀態會指數成長，廣度優先在推進到目標前就會用完額度。
  // 這時對每個還沒找到的目標做「目標導向」搜尋：優先展開任務進度較前、開關與物品較多的狀態。
  if (truncated) {
    for (const goal of goals) {
      if (firstGoal.has(goal.id)) continue;
      const found = targetedSearch(goal, nodes, terminal, (i, onChild) => expand(i, onChild, Infinity), options.targetedBudget ?? 20000);
      if (found !== null) firstGoal.set(goal.id, found);
    }
  }

  // 反向搜尋：哪些狀態還能走到任一目標
  const parents = nodes.map(() => [] as number[]);
  nodes.forEach((n, i) => n.children.forEach((c) => parents[c].push(i)));
  const canFinish = new Set<number>();
  const stack = nodes.flatMap((n, i) => (terminal(n.state) ? [i] : []));
  while (stack.length) {
    const i = stack.pop()!;
    if (canFinish.has(i)) continue;
    canFinish.add(i);
    parents[i].forEach((p) => stack.push(p));
  }

  const results: GoalResult[] = goals.map((g) => {
    const at = firstGoal.get(g.id);
    return at === undefined ? { id: g.id, title: g.title, reachable: false } : { id: g.id, title: g.title, reachable: true, ...trace(at) };
  });
  const softlockNodes = truncated ? [] : nodes.map((_, i) => i).filter((i) => !canFinish.has(i));
  const softlocks = softlockNodes.slice(0, 3).map((i) => ({ steps: trace(i).steps }));

  results.forEach((r) => {
    if (!r.reachable) issues.push({ path: `goals.${r.id}`, message: `自動試玩${truncated ? `（探索 ${maxStates} 個狀態後截斷）` : ""}找不到能達成「${r.title}」的路線` });
  });
  if (softlockNodes.length > 0) {
    issues.push({ path: "playtest", message: `自動試玩發現 ${softlockNodes.length} 個卡死狀態（之後無論怎麼玩都到不了結局），例如：${softlocks[0].steps.join(" → ")}` });
  }
  for (const [message, steps] of engineErrors) issues.push({ path: "playtest", message: `事件執行錯誤：${message}（重現步驟：${steps.join(" → ")}）` });
  return { ok: issues.length === 0, statesExplored: nodes.length, truncated, goals: results, softlocks, issues };
}

/** 啟發分數：任務進度、累積的開關、變數與物品 */
function progressScore(state: PlayerState): number {
  let score = 0;
  for (const q of Object.values(state.quests)) score += q.status === "completed" ? 20 : q.status === "active" ? 2 + q.step * 3 : 0;
  score += Object.values(state.switches).filter(Boolean).length * 2 + Object.values(state.selfSwitches).filter(Boolean).length;
  score += Object.keys(state.items).length + Object.keys(state.variables).length;
  return score;
}

function targetedSearch(
  goal: PlaytestGoal,
  nodes: Node[],
  terminal: (s: PlayerState) => boolean,
  expand: (i: number, onChild: (child: number, isNew: boolean) => void) => void,
  budget: number,
): number | null {
  const heap: Array<[number, number]> = [];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent][0] >= heap[i][0]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] > heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] > heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const depth = (i: number) => {
    let d = 0;
    for (let cur = i; cur > 0; cur = nodes[cur].parent) d++;
    return d;
  };
  push([progressScore(nodes[0].state), 0]);
  const expanded = new Set<number>();
  let added = 0;
  while (heap.length > 0 && added < budget) {
    const [, i] = pop();
    if (expanded.has(i)) continue;
    expanded.add(i);
    if (goal.reached(nodes[i].state)) return i;
    if (terminal(nodes[i].state)) continue;
    expand(i, (child, isNew) => {
      if (isNew) added++;
      if (!expanded.has(child)) push([progressScore(nodes[child].state) - depth(child) * 0.01, child]);
    });
  }
  return null;
}
