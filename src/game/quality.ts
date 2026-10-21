import { findCatalogAsset } from "./assets";
import type { ChapterReport } from "./chapters";
import { allConditions, allSources, conditionAtoms, walkCommands, walkCondition } from "./commands";
import { estimateDuration, type DurationEstimate } from "./duration";
import { createChapterState, createInitialState } from "./engine";
import { applyAction, settle, type PlaytestReport } from "./playtest";
import type { EventCommand, GameProject } from "./schema";
import type { ValidationIssue } from "./validate";

/**
 * 量化品質指標（自動審查的第一層，不使用 AI）。
 * validate 保證「能玩、不壞」；這裡檢查「像一款完整的 RPG」所需的最低份量與分支。
 * blocking 會退回修改；suggestions 只供 AI 審查與報告參考。
 */

export const QUALITY_THRESHOLDS = {
  minPeople: 3,
  minQuests: 1,
  minQuestSteps: 3,
  minItems: 1,
  minEndings: 2,
  maxEndings: 4,
  minTexts: 12,
  minMeaningfulChoices: 3,
  minActionsToEnding: 6,
  minAvgTextChars: 15,
  minInteractables: 2,
  maxPeople: 40,
  maxTexts: 1500,
  /**
   * 時長不設下限：長度由故事決定（寫在改編合約），下限只會逼 AI 灌水（X3）。
   * 全長超過 maxMinutes、單章超過 maxChapterMinutes 只是警告，提醒考慮分部或拆章。
   */
  maxMinutes: 120,
  maxChapterMinutes: 30,
  /** 章節：1～8 章（短篇一章完也可以） */
  minChapters: 1,
  maxChapters: 8,
};

export type QualityMetrics = {
  maps: number;
  /** 有角色圖、按確定鍵觸發的事件（NPC） */
  people: number;
  /** 沒有角色圖、按確定鍵觸發的事件（門、告示、寶箱…） */
  interactables: number;
  quests: number;
  questSteps: number;
  items: number;
  endings: number;
  chapters: number;
  texts: number;
  avgTextChars: number;
  /** 會改變狀態或接到不同內容的選項數 */
  meaningfulChoices: number;
  /** 各結局的最短通關行動數 */
  actionsToEnding: Record<string, number>;
  /** 各結局路線之間，至少有一個不同的選擇 */
  endingsHaveDistinctChoices: boolean;
  /** 至少在一條結局路線上互動過的 NPC 比例 */
  peopleCoverage: number;
  duration: DurationEstimate | null;
};

export type QualityReport = { metrics: QualityMetrics; blocking: ValidationIssue[]; suggestions: ValidationIssue[] };

const PLACEHOLDER = /\b(todo|tbd|lorem|placeholder)\b|待補|範例文字|xxx/i;
const STATE_CODES = new Set<EventCommand["code"]>(["switch", "selfSwitch", "variable", "item", "quest", "ending", "transfer", "jump", "text", "if", "common", "chapter"]);

function isCharacter(project: GameProject, assetId: string | undefined) {
  if (!assetId) return false;
  const kind = project.assetManifest.assets.find((a) => a.id === assetId)?.kind ?? findCatalogAsset(assetId)?.kind;
  return kind === "character";
}

/**
 * checkDuration=false：手寫的教學短篇（demo）不套用時長與章節規則。
 * chapters：章節檢查結果（見 chapters.ts），用來套用每章的時長與可玩性規則。
 */
export function assessQuality(project: GameProject, playtest: PlaytestReport, options: { checkDuration?: boolean; chapters?: ChapterReport[] } = {}): QualityReport {
  const t = QUALITY_THRESHOLDS;
  const blocking: ValidationIssue[] = [];
  const suggestions: ValidationIssue[] = [];

  const peopleIds = new Set<string>();
  let interactables = 0;
  for (const m of project.maps)
    for (const e of m.events) {
      const action = e.pages.filter((p) => p.trigger === "action" && p.commands.length > 0);
      if (action.some((p) => isCharacter(project, p.graphic?.assetId))) peopleIds.add(`${m.id}/${e.id}`);
      else if (action.length > 0) interactables++;
    }

  const texts: string[] = [];
  let meaningfulChoices = 0;
  for (const s of allSources(project))
    walkCommands(s.commands, (c) => {
      if (c.code === "text") texts.push(c.text);
      if (c.code === "choices") meaningfulChoices += c.options.filter((o) => o.commands.some((x) => STATE_CODES.has(x.code))).length;
    });
  const avgTextChars = texts.length ? Math.round(texts.reduce((n, x) => n + [...x].length, 0) / texts.length) : 0;

  // 重播每條結局路線：記錄做過的選擇與互動過的 NPC
  const routes = playtest.goals.filter((g) => g.reachable && g.actions);
  const actionsToEnding = Object.fromEntries(routes.map((g) => [g.id, g.actions!.length]));
  const choiceSets: Array<Set<string>> = [];
  const talked = new Set<string>();
  // 連載的「未完待續」結局只是章節的分界，不和真正的結局比較路線差異
  const bridge = new Set(project.endings.filter((e) => e.nextChapterId).map((e) => e.id));
  for (const g of routes) {
    let s = settle(project, g.fromChapter ? createChapterState(project, g.fromChapter) : createInitialState(project));
    for (const a of g.actions!) {
      if (a.kind === "event") talked.add(`${s.mapId}/${a.eventId}`);
      s = applyAction(project, s, a);
    }
    if (!bridge.has(g.id)) choiceSets.push(new Set(s.choiceLog));
  }
  const endingsHaveDistinctChoices = choiceSets.every((set, i) => choiceSets.every((other, j) => i === j || [...set].some((c) => !other.has(c))));
  const peopleCoverage = peopleIds.size ? [...peopleIds].filter((id) => talked.has(id)).length / peopleIds.size : 0;

  const metrics: QualityMetrics = {
    maps: project.maps.length,
    people: peopleIds.size,
    interactables,
    quests: project.quests.length,
    questSteps: project.quests.reduce((n, q) => n + q.steps.length, 0),
    items: project.items.length,
    // 連載的「未完待續」結局（nextChapterId）只是章節的收尾，不算進結局數
    endings: project.endings.filter((e) => !e.nextChapterId).length,
    chapters: project.chapters.length,
    texts: texts.length,
    avgTextChars,
    meaningfulChoices,
    actionsToEnding,
    endingsHaveDistinctChoices,
    peopleCoverage: Math.round(peopleCoverage * 100) / 100,
    duration: estimateDuration(project, playtest),
  };

  const need = (ok: boolean, path: string, message: string) => ok || blocking.push({ path, message });
  need(metrics.people >= t.minPeople, "maps.events", `NPC（有角色圖的對話事件）至少需要 ${t.minPeople} 位（目前 ${metrics.people}）`);
  need(metrics.people <= t.maxPeople, "maps.events", `NPC 最多 ${t.maxPeople} 位（目前 ${metrics.people}），請合併次要角色`);
  need(metrics.quests >= t.minQuests, "quests", `至少需要 ${t.minQuests} 條任務`);
  need(metrics.questSteps >= t.minQuestSteps, "quests", `任務步驟合計至少 ${t.minQuestSteps} 個（目前 ${metrics.questSteps}），主線太短`);
  need(metrics.items >= t.minItems, "items", `至少需要 ${t.minItems} 個物品`);
  const ongoing = project.release?.status === "ongoing";
  // 連載中：最後推出的一章可以只用「未完待續」的結局收尾，完結時才要求 2 種以上的結局
  if (!ongoing) need(metrics.endings >= t.minEndings, "endings", `至少需要 ${t.minEndings} 種結局（目前 ${metrics.endings}）`);
  need(metrics.endings <= t.maxEndings, "endings", `結局最多 ${t.maxEndings} 種（目前 ${metrics.endings}），太多容易讓結局文字與玩家路線矛盾`);
  need(metrics.texts >= t.minTexts, "texts", `顯示文字至少 ${t.minTexts} 則（目前 ${metrics.texts}）`);
  need(metrics.texts <= t.maxTexts, "texts", `顯示文字最多 ${t.maxTexts} 則（目前 ${metrics.texts}）`);
  need(meaningfulChoices >= t.minMeaningfulChoices, "choices", `有後果的選項至少 ${t.minMeaningfulChoices} 個（目前 ${meaningfulChoices}）`);
  need(avgTextChars >= t.minAvgTextChars, "texts", `文字平均只有 ${avgTextChars} 字，內容過於單薄（至少 ${t.minAvgTextChars} 字）`);
  need(interactables >= t.minInteractables, "maps.events", `可調查的事件至少 ${t.minInteractables} 個（目前 ${interactables}），例如門、告示、寶箱，讓玩家按確定鍵時有回應`);
  need(endingsHaveDistinctChoices, "endings", "不同結局的通關路線沒有任何不同的選擇，結局分支沒有意義");
  for (const [id, n] of Object.entries(actionsToEnding)) need(n >= t.minActionsToEnding, "endings", `結局「${id}」只要 ${n} 個行動就能達成，流程太短（至少 ${t.minActionsToEnding}）`);
  const typical = metrics.duration?.typicalMinutes;
  // 時長不設下限（長度由故事決定）；太長只提醒，不擋下
  if (options.checkDuration !== false && typical && !ongoing && typical[0] > t.maxMinutes)
    suggestions.push({ path: "duration", message: `預估遊玩時間 ${typical[0]}～${typical[1]} 分鐘，超過 ${t.maxMinutes} 分鐘：考慮分成第一部、第二部推出，或精簡沒有推進故事的段落` });

  // 章節（長篇以章為單位製作與把關）
  if (options.checkDuration !== false) {
    const n = project.chapters.length;
    need(n >= t.minChapters && n <= t.maxChapters, "chapters", `章節數要在 ${t.minChapters}～${t.maxChapters} 章（目前 ${n} 章）：用「章節」指令在劇情轉折處進入下一章`);
    for (const c of options.chapters ?? []) {
      need(c.ok, `chapters.${c.id}`, `第 ${c.index + 1} 章「${c.title}」從測試起點無法順利玩到${c.index + 1 < n ? "下一章" : "結局"}：${c.issues[0]?.message ?? "請檢查章節測試起點"}`);
      if (c.minutes && c.minutes[0] > t.maxChapterMinutes)
        suggestions.push({ path: `chapters.${c.id}`, message: `第 ${c.index + 1} 章「${c.title}」約 ${c.minutes[0]}～${c.minutes[1]} 分鐘，超過 ${t.maxChapterMinutes} 分鐘：考慮拆成兩章，讓玩家有喘口氣的段落` });
    }
  }

  for (const s of allSources(project))
    walkCommands(s.commands, (c) => {
      const text = c.code === "text" ? c.text : c.code === "choices" ? c.options.map((o) => o.text).join(" ") : "";
      if (text && PLACEHOLDER.test(text)) blocking.push({ path: s.label, message: `含有佔位文字：「${text.slice(0, 30)}」` });
    });
  project.endings.forEach((e) => PLACEHOLDER.test(e.text) && blocking.push({ path: "endings", message: `結局「${e.title}」含有佔位文字` }));

  // 簡介與開場文字：玩家在遊戲選單與開始遊戲時要知道大概的情境（連載的第 1 章上線時就需要）
  const desc = project.description.trim();
  need(desc.length >= 30 && !PLACEHOLDER.test(desc), "description", "遊戲簡介（遊戲選單上顯示）還沒寫好：用 2～4 句說明主角、處境與想要什麼，至少 30 字，不要劇透翻轉");
  const intro = (project.intro ?? "").trim();
  need(intro.length >= 20 && !PLACEHOLDER.test(intro), "intro", "開場文字（開始新遊戲時顯示）還沒寫好：用 1～3 段交代世界的情境，至少 20 字");

  // 死開關：被打開卻從來沒有被讀取（選擇沒有後果）
  const read = new Set<string>();
  const readVars = new Set<string>();
  allConditions(project).forEach((c) =>
    walkCondition(c, (a) => {
      if (a.type === "switch") read.add(a.id);
      if (a.type === "variable") readVars.add(a.id);
    }),
  );
  project.commonEvents.forEach((c) => c.switchId && read.add(c.switchId));
  const setOn = new Set<string>();
  const setVars = new Set<string>();
  for (const s of allSources(project))
    walkCommands(s.commands, (c) => {
      if (c.code === "switch" && c.value) c.ids.forEach((id) => setOn.add(id));
      if (c.code === "variable") setVars.add(c.id);
    });
  for (const id of setOn) if (!read.has(id)) blocking.push({ path: "switches", message: `開關「${project.switches.find((s) => s.id === id)?.name ?? id}」被打開卻從未被任何條件讀取（死開關，選擇沒有後果）` });
  for (const id of setVars) if (!readVars.has(id)) suggestions.push({ path: "variables", message: `變數「${project.variables.find((v) => v.id === id)?.name ?? id}」被設定卻從未被讀取` });

  // 結局至少由 2 個條件組合決定（外層的事件頁條件＋條件分支＋選項）
  for (const s of allSources(project)) {
    const pageAtoms = s.page?.conditions ? Object.values(s.page.conditions).filter(Boolean).length : 0;
    walkCommands(s.commands, (c, ctx) => {
      if (c.code !== "ending") return;
      // 連載的「未完待續」結局只是章節的收尾，不套用結局條件的規則
      if (project.endings.find((e) => e.id === c.endingId)?.nextChapterId) return;
      const atoms = pageAtoms + ctx.ancestors.reduce((n, a) => n + (a.cmd.code === "if" ? conditionAtoms(a.cmd.condition) : 1), 0);
      if (atoms < 2) blocking.push({ path: s.label, message: `結局「${project.endings.find((e) => e.id === c.endingId)?.title ?? c.endingId}」只由不到 2 個條件或選擇決定，應由玩家累積的多個選擇組合決定` });
    });
  }

  if (peopleCoverage < 1 && peopleIds.size > 0) suggestions.push({ path: "maps.events", message: `有 ${peopleIds.size - [...peopleIds].filter((id) => talked.has(id)).length} 位 NPC 不在任何結局路線上，考慮讓他們參與主線` });
  if (project.maps.length === 1) suggestions.push({ path: "maps", message: "只有一張地圖，可以增加地圖讓探索更有層次" });
  return { metrics, blocking, suggestions };
}
