import { estimateDuration, type DurationEstimate } from "./duration";
import type { PlaytestReport } from "./playtest";
import type { GameCondition, GameProject } from "./schema";
import type { ValidationIssue } from "./validate";

/**
 * 量化品質指標（自動 review 第一層，不使用 AI）。
 * validate 保證「能玩、不壞」；這裡檢查「像一款完整的 RPG」所需的最低份量與分支。
 * blocking 會退回 AI 修改；suggestions 只供 AI 審查與報告參考。
 */

export const QUALITY_THRESHOLDS = {
  minNpcs: 2,
  minQuests: 1,
  minObjectives: 3,
  minItems: 1,
  minEndings: 2,
  minDialogueNodes: 8,
  minMeaningfulChoices: 3,
  minStepsToEnding: 6,
  minAvgDialogueChars: 15,
  // 規模上限：結局太多時，結局文字與旗標組合容易互相矛盾（實測 8 個結局的版本審查一直不過），所以結局維持最多 4 個；
  // 其餘放寬到能做出 15～30 分鐘的遊戲
  maxEndings: 4,
  maxNpcs: 10,
  maxDialogueNodes: 140,
  /** 一般玩家預估時長（分鐘）的目標範圍 */
  targetMinutes: [15, 30] as [number, number],
  // E3／互動回饋：至少 2 個可調查物件，讓環境分擔說明、降低迷失感
  minInteractables: 2,
};

export type QualityMetrics = {
  npcs: number;
  quests: number;
  objectives: number;
  items: number;
  endings: number;
  dialogueNodes: number;
  /** 有 effect 或會導向不同節點的選項數 */
  meaningfulChoices: number;
  avgDialogueChars: number;
  /** 各結局的最短通關行動數 */
  stepsToEnding: Record<string, number>;
  /** 各結局路線之間，至少有一個不同的對話選擇 */
  endingsHaveDistinctChoices: boolean;
  /** 至少在一條結局路線上被對話過的 NPC 比例 */
  npcCoverage: number;
  /** 可調查物件數 */
  interactables: number;
  /** 預估遊玩時長（分鐘） */
  duration: DurationEstimate | null;
};

export type QualityReport = { metrics: QualityMetrics; blocking: ValidationIssue[]; suggestions: ValidationIssue[] };

const PLACEHOLDER = /\b(todo|tbd|lorem|placeholder)\b|待補|範例文字|xxx/i;

/** checkDuration=false：手寫的教學短篇（demo）不套用時長目標 */
export function assessQuality(project: GameProject, playtest: PlaytestReport, options: { checkDuration?: boolean } = {}): QualityReport {
  const t = QUALITY_THRESHOLDS;
  const blocking: ValidationIssue[] = [];
  const suggestions: ValidationIssue[] = [];
  const choices = project.dialogues.flatMap((d) => d.choices ?? []);
  const meaningfulChoices = choices.filter((c) => (c.effects?.length ?? 0) > 0 || c.nextNodeId).length;
  const texts = project.dialogues.map((d) => d.text);
  const avgDialogueChars = texts.length ? Math.round(texts.reduce((n, s) => n + [...s].length, 0) / texts.length) : 0;

  const routes = playtest.endings.filter((e) => e.reachable && e.actions);
  const stepsToEnding = Object.fromEntries(routes.map((e) => [e.endingId, e.actions!.length]));
  const choiceSets = routes.map((e) => new Set(e.actions!.flatMap((a) => (a.kind === "choose" ? [a.choiceId] : []))));
  const endingsHaveDistinctChoices = choiceSets.every((set, i) => choiceSets.every((other, j) => i === j || [...set].some((c) => !other.has(c))));
  const talked = new Set(routes.flatMap((e) => e.actions!.flatMap((a) => (a.kind === "talk" ? [a.npcId] : []))));
  const npcCoverage = project.npcs.length ? talked.size / project.npcs.length : 0;

  const metrics: QualityMetrics = {
    npcs: project.npcs.length,
    quests: project.quests.length,
    objectives: project.quests.reduce((n, q) => n + q.objectives.length, 0),
    items: project.items.length,
    endings: project.endings.length,
    dialogueNodes: project.dialogues.length,
    meaningfulChoices,
    avgDialogueChars,
    stepsToEnding,
    endingsHaveDistinctChoices,
    npcCoverage: Math.round(npcCoverage * 100) / 100,
    interactables: project.scenes.reduce((n, s) => n + (s.interactables?.length ?? 0), 0),
    duration: estimateDuration(project, playtest),
  };

  const need = (ok: boolean, path: string, message: string) => ok || blocking.push({ path, message });
  need(metrics.npcs >= t.minNpcs, "npcs", `NPC 至少需要 ${t.minNpcs} 位（目前 ${metrics.npcs}）`);
  need(metrics.quests >= t.minQuests, "quests", `至少需要 ${t.minQuests} 條任務`);
  need(metrics.objectives >= t.minObjectives, "quests", `任務目標合計至少 ${t.minObjectives} 個（目前 ${metrics.objectives}），主線太短`);
  need(metrics.items >= t.minItems, "items", `至少需要 ${t.minItems} 個可取得的物品`);
  need(metrics.endings >= t.minEndings, "endings", `至少需要 ${t.minEndings} 種結局（目前 ${metrics.endings}）`);
  need(metrics.dialogueNodes >= t.minDialogueNodes, "dialogues", `對話節點至少 ${t.minDialogueNodes} 個（目前 ${metrics.dialogueNodes}）`);
  need(metrics.meaningfulChoices >= t.minMeaningfulChoices, "dialogues", `有效果或會分支的對話選項至少 ${t.minMeaningfulChoices} 個（目前 ${meaningfulChoices}）`);
  need(avgDialogueChars >= t.minAvgDialogueChars, "dialogues", `對話平均只有 ${avgDialogueChars} 字，內容過於單薄（至少 ${t.minAvgDialogueChars} 字）`);
  const typical = metrics.duration?.typicalMinutes;
  if (options.checkDuration !== false && typical) {
    need(typical[1] >= t.targetMinutes[0], "duration", `預估遊玩時間只有 ${typical[0]}～${typical[1]} 分鐘，目標是 ${t.targetMinutes[0]}～${t.targetMinutes[1]} 分鐘：請增加章節、支線、場景與調查內容`);
    need(typical[0] <= t.targetMinutes[1], "duration", `預估遊玩時間 ${typical[0]}～${typical[1]} 分鐘超過 ${t.targetMinutes[1]} 分鐘上限，請精簡`);
  }
  need(metrics.endings <= t.maxEndings, "endings", `結局最多 ${t.maxEndings} 種（目前 ${metrics.endings}），規模太大容易讓結局文字與玩家路線矛盾`);
  need(metrics.npcs <= t.maxNpcs, "npcs", `NPC 最多 ${t.maxNpcs} 位（目前 ${metrics.npcs}），請合併或刪減次要角色`);
  need(metrics.dialogueNodes <= t.maxDialogueNodes, "dialogues", `對話節點最多 ${t.maxDialogueNodes} 個（目前 ${metrics.dialogueNodes}），超出 10 分鐘的遊玩預算`);
  need(metrics.interactables >= t.minInteractables, "scenes.interactables", `可調查物件至少 ${t.minInteractables} 個（目前 ${metrics.interactables}），例如門、告示、寶箱，讓玩家按確認鍵時有回應`);
  need(endingsHaveDistinctChoices, "endings", "不同結局的通關路線沒有任何不同的選擇，結局分支沒有意義");
  for (const [id, steps] of Object.entries(stepsToEnding)) {
    need(steps >= t.minStepsToEnding, "endings", `結局「${id}」只要 ${steps} 個行動就能達成，流程太短（至少 ${t.minStepsToEnding}）`);
  }

  const texty = [
    ...project.dialogues.map((d, i) => [`dialogues[${i}].text`, d.text] as const),
    ...project.npcs.map((n, i) => [`npcs[${i}].description`, n.description] as const),
    ...project.endings.map((e, i) => [`endings[${i}].text`, e.text] as const),
  ];
  for (const [path, text] of texty) if (PLACEHOLDER.test(text)) blocking.push({ path, message: `含有 placeholder 文字：「${text.slice(0, 30)}」` });

  // A3：死旗標（被設定但從未被任何條件讀取）
  const readFlags = new Set<string>();
  const collectReads = (c: GameCondition | undefined): void => {
    if (!c) return;
    if (c.type === "flag_equals") readFlags.add(c.flag);
    if (c.type === "all" || c.type === "any") c.conditions.forEach(collectReads);
    if (c.type === "not") collectReads(c.condition);
  };
  project.npcs.forEach((n) => n.dialogueVariants?.forEach((v) => collectReads(v.condition)));
  project.dialogues.forEach((d) => d.choices?.forEach((c) => collectReads(c.condition)));
  project.quests.forEach((q) => collectReads(q.startCondition));
  project.endings.forEach((e) => {
    collectReads(e.condition);
    e.epilogues?.forEach((x) => collectReads(x.condition));
  });
  project.scenes.forEach((sc) => sc.pickups?.forEach((pk) => collectReads(pk.condition)));
  project.scenes.forEach((sc) => sc.interactables?.forEach((o) => o.dialogueVariants?.forEach((v) => collectReads(v.condition))));
  const effects = [...choices.flatMap((c) => c.effects ?? []), ...project.quests.flatMap((q) => q.rewards ?? [])];
  const setFlags = new Set(effects.flatMap((e) => (e.type === "set_flag" ? [e.flag] : [])));
  for (const flag of setFlags) if (!readFlags.has(flag)) blocking.push({ path: "flags", message: `旗標「${flag}」被設定但從未被任何條件讀取（死旗標，選擇沒有後果）` });

  // F1：結局至少由 2 個條件組合決定
  const atoms = (c: GameCondition): number => (c.type === "all" || c.type === "any" ? c.conditions.reduce((n, x) => n + atoms(x), 0) : c.type === "not" ? atoms(c.condition) : 1);
  project.endings.forEach((e, i) => {
    if (atoms(e.condition) < 2) blocking.push({ path: `endings[${i}]`, message: `結局「${e.title}」只由單一條件決定，應由至少 2 個旗標或狀態組合決定` });
  });

  // C3：物品要有用途
  const usedItems = new Set<string>();
  const collectItems = (c: GameCondition | undefined): void => {
    if (!c) return;
    if (c.type === "has_item") usedItems.add(c.itemId);
    if (c.type === "all" || c.type === "any") c.conditions.forEach(collectItems);
    if (c.type === "not") collectItems(c.condition);
  };
  project.npcs.forEach((n) => n.dialogueVariants?.forEach((v) => collectItems(v.condition)));
  project.scenes.forEach((sc) => sc.interactables?.forEach((o) => o.dialogueVariants?.forEach((v) => collectItems(v.condition))));
  project.dialogues.forEach((d) => d.choices?.forEach((c) => collectItems(c.condition)));
  project.endings.forEach((e) => collectItems(e.condition));
  project.quests.forEach((q) => q.objectives.forEach((o) => o.type === "collect_item" && usedItems.add(o.targetId)));
  effects.forEach((e) => e.type === "remove_item" && usedItems.add(e.itemId));
  for (const item of project.items) if (!usedItems.has(item.id)) suggestions.push({ path: "items", message: `物品「${item.name}」取得後沒有任何用途（C3）` });

  if (npcCoverage < 1) suggestions.push({ path: "npcs", message: `有 ${project.npcs.length - talked.size} 位 NPC 不在任何結局路線上，考慮讓他們參與主線` });
  if (project.scenes.length === 1) suggestions.push({ path: "scenes", message: "只有一個場景，可考慮增加第二個場景讓探索更有層次" });
  return { metrics, blocking, suggestions };
}
