import type {
  DialogueChoice,
  DialogueNode,
  GameCondition,
  GameEffect,
  GameProject,
  NPCDefinition,
  SceneDefinition,
} from "./schema";

/**
 * 確定性的 RPG Runtime 邏輯（SPEC §9）。
 * 所有動作都是 (project, state) => 新 state 的純函式；renderer 與 UI 只負責呈現與輸入。
 * 玩家進度（PlayerState）與靜態的 GameProject 完全分離。
 */

export type Direction = "up" | "down" | "left" | "right";
export type FlagValue = string | number | boolean;

export type QuestStatus = "inactive" | "active" | "completed";
export type QuestProgress = {
  status: QuestStatus;
  /** 目前進行到第幾個目標（任務目標依序完成） */
  objectiveIndex: number;
  /** 目前目標累計次數 */
  count: number;
};

export type PlayerState = {
  schemaVersion: "1.0";
  projectId: string;
  /** 對應的 GameProject 內容指紋；專案內容變更後舊存檔會被視為不相容 */
  projectRevision: string;
  sceneId: string;
  x: number;
  y: number;
  facing: Direction;
  stats: { hp: number; level: number; xp: number };
  inventory: Record<string, number>;
  flags: Record<string, FlagValue>;
  quests: Record<string, QuestProgress>;
  collectedPickups: string[];
  choicesMade: string[];
  dialogue: { npcId: string; nodeId: string } | null;
  endingId: string | null;
  /** 最近的遊戲訊息（例如獲得物品），供 UI 顯示 */
  log: string[];
  steps: number;
};

export type GameEvent =
  | { type: "moved" }
  | { type: "blocked" }
  | { type: "scene_changed"; sceneId: string }
  | { type: "item_gained"; itemId: string; count: number }
  | { type: "item_removed"; itemId: string; count: number }
  | { type: "xp_gained"; amount: number }
  | { type: "level_up"; level: number }
  | { type: "quest_started"; questId: string }
  | { type: "objective_completed"; questId: string; objectiveId: string }
  | { type: "quest_completed"; questId: string }
  | { type: "dialogue_opened"; npcId: string; nodeId: string }
  | { type: "dialogue_closed" }
  | { type: "ending_reached"; endingId: string };

export type ActionResult = { state: PlayerState; events: GameEvent[] };

const DELTA: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const MAX_LOG = 6;
export const XP_PER_LEVEL = 100;

// ---------- 查詢輔助 ----------

export function getScene(project: GameProject, sceneId: string): SceneDefinition {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`找不到場景 ${sceneId}`);
  return scene;
}

export function getDialogueNode(project: GameProject, nodeId: string): DialogueNode {
  const node = project.dialogues.find((d) => d.id === nodeId);
  if (!node) throw new Error(`找不到對話節點 ${nodeId}`);
  return node;
}

function itemName(project: GameProject, itemId: string) {
  return project.items.find((i) => i.id === itemId)?.name ?? itemId;
}

function questTitle(project: GameProject, questId: string) {
  return project.quests.find((q) => q.id === questId)?.title ?? questId;
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

// ---------- 初始化 ----------

export function createInitialState(project: GameProject): PlayerState {
  const { player } = project;
  const inventory: Record<string, number> = {};
  for (const itemId of player.inventoryItemIds) inventory[itemId] = (inventory[itemId] ?? 0) + 1;
  const quests: Record<string, QuestProgress> = {};
  for (const q of project.quests) quests[q.id] = { status: "inactive", objectiveIndex: 0, count: 0 };

  const state: PlayerState = {
    schemaVersion: "1.0",
    projectId: project.id,
    projectRevision: projectRevision(project),
    sceneId: player.startPosition.sceneId,
    x: player.startPosition.x,
    y: player.startPosition.y,
    facing: "down",
    stats: { ...player.baseStats },
    inventory,
    flags: {},
    quests,
    collectedPickups: [],
    choicesMade: [],
    dialogue: null,
    endingId: null,
    log: [],
    steps: 0,
  };
  // 沒有開始條件的任務在遊戲一開始就啟動
  return refresh(project, state, []).state;
}

// ---------- 條件 ----------

export function evaluateCondition(state: PlayerState, condition: GameCondition): boolean {
  switch (condition.type) {
    case "quest_completed":
      return state.quests[condition.questId]?.status === "completed";
    case "quest_active":
      return state.quests[condition.questId]?.status === "active";
    case "has_item":
      return (state.inventory[condition.itemId] ?? 0) >= (condition.count ?? 1);
    case "flag_equals":
      return state.flags[condition.flag] === condition.value;
    case "stat_at_least":
      return state.stats[condition.stat] >= condition.value;
    case "all":
      return condition.conditions.every((c) => evaluateCondition(state, c));
    case "any":
      return condition.conditions.some((c) => evaluateCondition(state, c));
    case "not":
      return !evaluateCondition(state, condition.condition);
  }
}

// ---------- 背包 ----------

export function addItem(state: PlayerState, itemId: string, count = 1): PlayerState {
  return { ...state, inventory: { ...state.inventory, [itemId]: (state.inventory[itemId] ?? 0) + count } };
}

export function removeItem(state: PlayerState, itemId: string, count = 1): { state: PlayerState; removed: number } {
  const current = state.inventory[itemId] ?? 0;
  const removed = Math.min(current, count);
  const inventory = { ...state.inventory };
  if (current - removed <= 0) delete inventory[itemId];
  else inventory[itemId] = current - removed;
  return { state: { ...state, inventory }, removed };
}

// ---------- Effects ----------

function pushLog(state: PlayerState, message: string): PlayerState {
  return { ...state, log: [...state.log, message].slice(-MAX_LOG) };
}

export function applyEffect(project: GameProject, state: PlayerState, effect: GameEffect, events: GameEvent[]): PlayerState {
  switch (effect.type) {
    case "give_item": {
      const count = effect.count ?? 1;
      events.push({ type: "item_gained", itemId: effect.itemId, count });
      return pushLog(addItem(state, effect.itemId, count), `獲得「${itemName(project, effect.itemId)}」×${count}`);
    }
    case "remove_item": {
      const result = removeItem(state, effect.itemId, effect.count ?? 1);
      if (result.removed === 0) return result.state;
      events.push({ type: "item_removed", itemId: effect.itemId, count: result.removed });
      return pushLog(result.state, `交出「${itemName(project, effect.itemId)}」×${result.removed}`);
    }
    case "add_xp": {
      const xp = Math.max(0, state.stats.xp + effect.amount);
      const level = Math.max(state.stats.level, 1 + Math.floor(xp / XP_PER_LEVEL));
      events.push({ type: "xp_gained", amount: effect.amount });
      let next = pushLog({ ...state, stats: { ...state.stats, xp, level } }, `經驗值 ${effect.amount >= 0 ? "+" : ""}${effect.amount}`);
      if (level > state.stats.level) {
        events.push({ type: "level_up", level });
        next = pushLog(next, `升級！目前等級 ${level}`);
      }
      return next;
    }
    case "set_flag":
      return { ...state, flags: { ...state.flags, [effect.flag]: effect.value } };
    case "complete_quest":
      return completeQuest(project, state, effect.questId, events);
  }
}

export function applyEffects(project: GameProject, state: PlayerState, effects: GameEffect[] | undefined, events: GameEvent[]) {
  let next = state;
  for (const effect of effects ?? []) next = applyEffect(project, next, effect, events);
  return next;
}

// ---------- 任務 ----------

function completeQuest(project: GameProject, state: PlayerState, questId: string, events: GameEvent[]): PlayerState {
  const quest = project.quests.find((q) => q.id === questId);
  const progress = state.quests[questId];
  if (!quest || !progress || progress.status === "completed") return state;
  let next: PlayerState = {
    ...state,
    quests: { ...state.quests, [questId]: { status: "completed", objectiveIndex: quest.objectives.length, count: 0 } },
  };
  events.push({ type: "quest_completed", questId });
  next = pushLog(next, `任務完成：${quest.title}`);
  return applyEffects(project, next, quest.rewards, events);
}

/**
 * 推進符合條件的任務目標。任務目標依序完成：只有「目前目標」會被推進。
 */
export function progressObjective(
  project: GameProject,
  state: PlayerState,
  type: "talk_to_npc" | "collect_item" | "reach_location" | "make_choice",
  targetId: string,
  events: GameEvent[],
  amount = 1,
): PlayerState {
  let next = state;
  for (const quest of project.quests) {
    const progress = next.quests[quest.id];
    if (progress?.status !== "active") continue;
    const objective = quest.objectives[progress.objectiveIndex];
    if (!objective || objective.type !== type || objective.targetId !== targetId) continue;

    const required = objective.requiredCount ?? 1;
    const count = type === "collect_item" ? amount : progress.count + amount;
    if (count < required) {
      next = { ...next, quests: { ...next.quests, [quest.id]: { ...progress, count } } };
      continue;
    }
    events.push({ type: "objective_completed", questId: quest.id, objectiveId: objective.id });
    next = pushLog(next, `目標完成：${objective.description}`);
    const objectiveIndex = progress.objectiveIndex + 1;
    next = { ...next, quests: { ...next.quests, [quest.id]: { status: "active", objectiveIndex, count: 0 } } };
    if (objectiveIndex >= quest.objectives.length) next = completeQuest(project, next, quest.id, events);
  }
  return next;
}

function locationsAt(scene: SceneDefinition, x: number, y: number) {
  return (scene.locations ?? []).filter(
    (loc) => x >= loc.x && x < loc.x + (loc.width ?? 1) && y >= loc.y && y < loc.y + (loc.height ?? 1),
  );
}

/**
 * 依目前狀態結算所有「狀態型」規則直到穩定：任務開始條件、收集／抵達目標、結局條件。
 */
export function refresh(project: GameProject, input: PlayerState, events: GameEvent[]): ActionResult {
  let state = input;
  for (let guard = 0; guard < 20; guard++) {
    const before = JSON.stringify(state.quests) + JSON.stringify(state.inventory);

    for (const quest of project.quests) {
      const progress = state.quests[quest.id] ?? { status: "inactive", objectiveIndex: 0, count: 0 };
      if (progress.status === "inactive" && (!quest.startCondition || evaluateCondition(state, quest.startCondition))) {
        state = { ...state, quests: { ...state.quests, [quest.id]: { status: "active", objectiveIndex: 0, count: 0 } } };
        events.push({ type: "quest_started", questId: quest.id });
        state = pushLog(state, `新任務：${quest.title}`);
      }
    }

    for (const quest of project.quests) {
      const progress = state.quests[quest.id];
      if (progress?.status !== "active") continue;
      const objective = quest.objectives[progress.objectiveIndex];
      if (objective?.type === "collect_item") {
        state = progressObjective(project, state, "collect_item", objective.targetId, events, state.inventory[objective.targetId] ?? 0);
      } else if (objective?.type === "reach_location") {
        const scene = getScene(project, state.sceneId);
        if (locationsAt(scene, state.x, state.y).some((l) => l.id === objective.targetId)) {
          state = progressObjective(project, state, "reach_location", objective.targetId, events);
        }
      }
    }

    if (JSON.stringify(state.quests) + JSON.stringify(state.inventory) === before) break;
  }

  if (!state.endingId) {
    const ending = project.endings.find((e) => evaluateCondition(state, e.condition));
    if (ending) {
      state = { ...state, endingId: ending.id, dialogue: null };
      events.push({ type: "ending_reached", endingId: ending.id });
    }
  }
  return { state, events };
}

// ---------- 地圖與移動 ----------

export function isWalkable(scene: SceneDefinition, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= scene.width || y >= scene.height) return false;
  return scene.walkable[y]?.[x] === true;
}

export function npcsInScene(project: GameProject, sceneId: string): NPCDefinition[] {
  return project.npcs.filter((n) => n.sceneId === sceneId);
}

export function visiblePickups(project: GameProject, state: PlayerState, sceneId = state.sceneId) {
  const scene = getScene(project, sceneId);
  return (scene.pickups ?? []).filter(
    (p) => !state.collectedPickups.includes(p.id) && (!p.condition || evaluateCondition(state, p.condition)),
  );
}

export function canMoveTo(project: GameProject, sceneId: string, x: number, y: number): boolean {
  const scene = getScene(project, sceneId);
  if (!isWalkable(scene, x, y)) return false;
  return !npcsInScene(project, sceneId).some((n) => n.position.x === x && n.position.y === y);
}

export function isInputLocked(state: PlayerState) {
  return state.dialogue !== null || state.endingId !== null;
}

export function move(project: GameProject, input: PlayerState, direction: Direction): ActionResult {
  const events: GameEvent[] = [];
  if (isInputLocked(input)) return { state: input, events };
  let state: PlayerState = { ...input, facing: direction };
  const [dx, dy] = DELTA[direction];
  const tx = state.x + dx;
  const ty = state.y + dy;
  if (!canMoveTo(project, state.sceneId, tx, ty)) {
    events.push({ type: "blocked" });
    return { state, events };
  }
  state = { ...state, x: tx, y: ty, steps: state.steps + 1 };
  events.push({ type: "moved" });

  let scene = getScene(project, state.sceneId);
  const exit = scene.exits.find((e) => e.x === tx && e.y === ty);
  if (exit) {
    state = { ...state, sceneId: exit.targetSceneId, x: exit.targetX, y: exit.targetY };
    scene = getScene(project, exit.targetSceneId);
    events.push({ type: "scene_changed", sceneId: exit.targetSceneId });
    state = pushLog(state, `進入「${scene.name}」`);
  }

  for (const pickup of visiblePickups(project, state)) {
    if (pickup.x === state.x && pickup.y === state.y) {
      state = { ...state, collectedPickups: [...state.collectedPickups, pickup.id] };
      state = applyEffect(project, state, { type: "give_item", itemId: pickup.itemId, count: pickup.count ?? 1 }, events);
    }
  }

  for (const loc of locationsAt(scene, state.x, state.y)) {
    state = progressObjective(project, state, "reach_location", loc.id, events);
  }
  return refresh(project, state, events);
}

// ---------- NPC 互動與對話 ----------

/** 互動範圍：與玩家相鄰（含斜角）的 NPC */
export function findNearbyNpc(project: GameProject, state: PlayerState): NPCDefinition | null {
  const npcs = npcsInScene(project, state.sceneId).filter(
    (n) => Math.max(Math.abs(n.position.x - state.x), Math.abs(n.position.y - state.y)) <= 1,
  );
  if (npcs.length === 0) return null;
  // 優先選擇面向的 NPC
  const [dx, dy] = DELTA[state.facing];
  return npcs.find((n) => n.position.x === state.x + dx && n.position.y === state.y + dy) ?? npcs[0];
}

export function resolveDialogueStart(npc: NPCDefinition, state: PlayerState): string {
  const variant = npc.dialogueVariants?.find((v) => evaluateCondition(state, v.condition));
  return variant?.dialogueNodeId ?? npc.dialogueNodeId;
}

/**
 * 與附近 NPC 互動。順序固定：先推進 talk_to_npc 目標並結算，再依新狀態選擇對話分支。
 */
export function interact(project: GameProject, input: PlayerState): ActionResult {
  const events: GameEvent[] = [];
  if (isInputLocked(input)) return { state: input, events };
  const npc = findNearbyNpc(project, input);
  if (!npc) return { state: input, events };
  let state = progressObjective(project, input, "talk_to_npc", npc.id, events);
  state = refresh(project, state, events).state;
  if (state.endingId) return { state, events };
  const nodeId = resolveDialogueStart(npc, state);
  state = { ...state, dialogue: { npcId: npc.id, nodeId } };
  events.push({ type: "dialogue_opened", npcId: npc.id, nodeId });
  return { state, events };
}

export function currentDialogueNode(project: GameProject, state: PlayerState): DialogueNode | null {
  return state.dialogue ? getDialogueNode(project, state.dialogue.nodeId) : null;
}

export function availableChoices(project: GameProject, state: PlayerState): DialogueChoice[] {
  const node = currentDialogueNode(project, state);
  if (!node) return [];
  return (node.choices ?? []).filter((c) => !c.condition || evaluateCondition(state, c.condition));
}

export function choose(project: GameProject, input: PlayerState, choiceId: string): ActionResult {
  const events: GameEvent[] = [];
  if (!input.dialogue || input.endingId) return { state: input, events };
  const choice = availableChoices(project, input).find((c) => c.id === choiceId);
  if (!choice) return { state: input, events };

  let state: PlayerState = { ...input, choicesMade: [...input.choicesMade, choice.id] };
  state = applyEffects(project, state, choice.effects, events);
  state = progressObjective(project, state, "make_choice", choice.id, events);
  if (choice.nextNodeId) {
    state = { ...state, dialogue: { npcId: input.dialogue.npcId, nodeId: choice.nextNodeId } };
  } else {
    state = { ...state, dialogue: null };
    events.push({ type: "dialogue_closed" });
  }
  return refresh(project, state, events);
}

/** 關閉對話（用於沒有選項的節點，或玩家按 Esc） */
export function closeDialogue(project: GameProject, input: PlayerState): ActionResult {
  if (!input.dialogue) return { state: input, events: [] };
  return refresh(project, { ...input, dialogue: null }, [{ type: "dialogue_closed" }]);
}

// ---------- 任務追蹤顯示 ----------

export function questTracker(project: GameProject, state: PlayerState) {
  return project.quests
    .filter((q) => state.quests[q.id]?.status !== "inactive")
    .map((q) => {
      const progress = state.quests[q.id];
      return {
        id: q.id,
        title: questTitle(project, q.id),
        description: q.description,
        status: progress.status,
        objectives: q.objectives.map((o, index) => ({
          id: o.id,
          description: o.description,
          done: progress.status === "completed" || index < progress.objectiveIndex,
          current: progress.status === "active" && index === progress.objectiveIndex,
          count: index === progress.objectiveIndex ? progress.count : undefined,
          required: o.requiredCount ?? 1,
        })),
      };
    });
}
