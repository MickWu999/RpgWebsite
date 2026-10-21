import { z } from "zod";
import { describeCommandList, describeCondition, describePageConditions, PRIORITY_LABEL, TRIGGER_LABEL } from "@/game/describe";
import type { PlaytestReport } from "@/game/playtest";
import type { QualityReport } from "@/game/quality";
import type { GameProject } from "@/game/schema";
import { toCliJsonSchema } from "./outputSchema";
import type { StoryProvider } from "./provider";
import { DESIGN_GUIDE, REVIEW_RUBRIC, TREATMENT_RUBRIC } from "./designGuide";

/**
 * 自動審查的第二層：獨立的 AI 審查員（另開一次 Claude Code，看不到製作過程）。
 * 三種審查：劇本大綱（動工前）、章節（每章做完）、整體（發布前）。
 * 依固定評分標準打分；是否通過由程式依分數規則判定（不採信 AI 自己的 verdict）。
 */

const score = z.number().int().min(1).max(10);
const issuesSchema = z
  .array(
    z.strictObject({
      severity: z.enum(["critical", "major", "minor"]),
      area: z.string().max(40),
      problem: z.string().max(400),
      suggestion: z.string().max(400),
    }),
  )
  .max(15);

/**
 * 玩家評審團：三種玩家各自回答「你會想玩下一章嗎？」。好不好玩最後看這個，不看規則有沒有逐條做到。
 * veteran＝玩過上百款 RPG 的老玩家（專挑「這我看過」）；casual＝只想輕鬆玩的玩家（專挑無聊、想跳過的地方）；story＝重視劇情的玩家（專挑角色與情感）。
 */
const playersSchema = z
  .array(z.strictObject({ persona: z.enum(["veteran", "casual", "story"]), wouldContinue: z.boolean(), reason: z.string().max(300) }))
  .min(3)
  .max(3);

/** 重審時，逐條判定上一輪的問題是否已解決（讓審查收斂，不會每一輪都換一批新問題） */
const followUpSchema = z.array(z.strictObject({ problem: z.string().max(200), resolved: z.boolean(), note: z.string().max(300) })).max(20);

export const reviewSchema = z.strictObject({
  scores: z.strictObject({
    fidelity: score,
    structure: score,
    choices: score,
    quests: score,
    characters: score,
    pacing: score,
    endings: score,
    feedback: score,
    arc: score,
    fun: score,
    soul: score,
  }),
  overall: score,
  summary: z.string().max(800),
  players: playersSchema,
  issues: issuesSchema,
  followUp: followUpSchema,
});
export type AiReview = z.infer<typeof reviewSchema>;

export const treatmentReviewSchema = z.strictObject({
  scores: z.strictObject({ premise: score, surprise: score, hook: score, arc: score, characters: score, choices: score, variety: score, endings: score, budget: score }),
  overall: score,
  summary: z.string().max(800),
  players: playersSchema,
  issues: issuesSchema,
  followUp: followUpSchema,
});
export type TreatmentReview = z.infer<typeof treatmentReviewSchema>;

/**
 * 通過門檻：總分 ≥ 7、故事面向 ≥ 6、技術面向 ≥ 5、沒有 critical、major 最多 3 個、玩家評審團至少 2 人想繼續玩。
 * - major 原本最多 1 個，但審查員每次都會列出許多 major，實測分數持續進步卻一直被這條擋下，所以放寬到 3 個。
 * - 技術面向（結構、任務、回饋、節奏、多樣性、規模）只是安全網：門檻放到 5，避免 AI 為了逐條符合規則而把故事寫得僵硬。
 *   好不好玩改由故事面向與玩家評審團決定。
 */
export const REVIEW_PASS_RULE = { minOverall: 7, minEachScore: 6, minCraftScore: 5, maxMajorIssues: 3, minPlayersContinue: 2 };
export const CRAFT_SCORES = new Set(["structure", "quests", "feedback", "pacing", "variety", "budget"]);

/** 大綱裡的劇透線：線以上是玩家在第 1 章結束前會知道的事，盲猜測試只讓猜測者看線以上的內容 */
export const SPOILER_LINE = "<!-- 劇透線 -->";

export type ReviewKind = "treatment" | "chapter" | "full";
export type ReviewResult = {
  kind: ReviewKind;
  target: string;
  revision?: string;
  passed: boolean;
  review: AiReview | TreatmentReview;
  reasons: string[];
  /** 大綱審查的盲猜測試結果（沒有劇透線時為 null） */
  prediction?: BlindPrediction | null;
  reviewedAt: string;
};

const SHARED = `以下是本平台採用的敘事設計準則（製作端也照這份準則設計）：
${DESIGN_GUIDE}

評分的優先順序：P（故事的靈魂）是主角，A～H 是輔助與安全網。
- 不要因為沒有照 A～H 的字面去做就扣分；只要玩家體驗達到那條規則的目的就好。
- 反過來，就算每條規則都做到了，故事平淡、好猜、似曾相識，premise／surprise／soul 一樣要給低分。
- players 要用三種玩家的角度分別回答「讀完／玩完這裡，你會想繼續玩下一章嗎？」並寫出最主要的原因，不要三個都給一樣的答案。

問題的嚴重度：critical = 不修改就不能繼續；major = 明顯影響體驗；minor = 可以更好。
只列出真正影響分數的問題：每個 major 都要對應到某個低於 8 分的面向；不要為了湊數而挑小毛病，minor 最多 5 個。
如果提供了 <previous_review>（上一輪的審查），請先在 followUp 逐條判定那些問題是否已解決，再評分：
- 已解決的問題不要再提；分數應該反映這些改善。
- 新問題只有在屬於 critical，或會讓某個面向低於 6 分時才能提出，避免每一輪都換一批新標準。
沒有上一輪審查時，followUp 給空陣列。
如果提供了 <lessons>（案例庫：過去的玩家回饋與審查中最常出現的問題），請特別檢查這些問題是否重演。
每個問題都要具體指出位置（章節、事件 ID、角色、任務或結局）並給出可以直接執行的修改建議。
所有文字使用繁體中文（台灣用語）。`;

const REVIEW_SYSTEM_PROMPT = `你是獨立的 RPG 品質審查員，也是一位資深的 RPG 劇本與關卡設計師。
你要判斷一份由 AI 製作、以 RPG Maker 事件模型寫成的 2D 敘事 RPG（無戰鬥）是否好玩、是否達到可以發布的品質。
你沒有參與製作，請只根據提供的「故事原文」「劇本大綱」「遊戲內容」與「自動試玩路線」嚴格評分，不要假設沒有提供的內容。
程式已經驗證過資料格式、引用與結局可達性，請不要重複檢查這些，專注在內容品質與好玩程度。

${SHARED}

${REVIEW_RUBRIC}`;

const TREATMENT_SYSTEM_PROMPT = `你是資深的 RPG 劇本統籌，負責在動工前審查一份 1～2 小時、分章製作的敘事 RPG（無戰鬥）劇本大綱。
故事不夠好就不應該開始製作：請以「玩家會不會想一章接一章玩下去」為核心嚴格評分。

${SHARED}

${TREATMENT_RUBRIC}`;

function judge(review: { overall: number; scores: Record<string, number>; issues: Array<{ severity: string }>; players?: Array<{ wouldContinue: boolean }> }) {
  const reasons: string[] = [];
  if (review.overall < REVIEW_PASS_RULE.minOverall) reasons.push(`總分 ${review.overall} 低於 ${REVIEW_PASS_RULE.minOverall}`);
  for (const [k, v] of Object.entries(review.scores)) {
    const min = CRAFT_SCORES.has(k) ? REVIEW_PASS_RULE.minCraftScore : REVIEW_PASS_RULE.minEachScore;
    if (v < min) reasons.push(`${k} 只有 ${v} 分`);
  }
  const keepGoing = (review.players ?? []).filter((x) => x.wouldContinue).length;
  if (review.players && keepGoing < REVIEW_PASS_RULE.minPlayersContinue) reasons.push(`玩家評審團只有 ${keepGoing}／3 人想繼續玩`);
  const critical = review.issues.filter((i) => i.severity === "critical").length;
  if (critical > 0) reasons.push(`有 ${critical} 個 critical 問題`);
  const major = review.issues.filter((i) => i.severity === "major").length;
  if (major > REVIEW_PASS_RULE.maxMajorIssues) reasons.push(`有 ${major} 個 major 問題（最多 ${REVIEW_PASS_RULE.maxMajorIssues} 個）`);
  return reasons;
}

/** 把 GameProject 轉成審查員（與 AI agent）容易閱讀的 RPG Maker 式摘要：資料庫＋每個事件頁的執行內容 */
export function projectDigest(project: GameProject, playtest: PlaytestReport | null, onlyMaps?: Set<string>): string {
  const lines: string[] = [`# ${project.title}（${project.genre}）`, project.description, project.intro ?? "", ""];
  lines.push("## 角色");
  for (const a of project.actors) lines.push(`- ${a.name}（${a.id}）${a.id === project.system.playerActorId ? "［主角］" : ""}${a.profile ? `：${a.profile}` : ""}`);
  lines.push("", "## 章節");
  project.chapters.forEach((c, i) => lines.push(`${i + 1}. ${c.title}（${c.id}）${c.summary ? `：${c.summary}` : ""}`));
  lines.push("", "## 任務");
  for (const q of project.quests) {
    lines.push(`- ${q.title}（${q.id}）：${q.description}`);
    q.steps.forEach((st, i) => lines.push(`  step ${i}. ${st.text}`));
  }
  lines.push("", "## 物品");
  for (const i of project.items) lines.push(`- ${i.name}（${i.id}）：${i.description}`);
  lines.push(`初始物品：${project.system.initialItems.map((i) => `${i.itemId}×${i.count}`).join("、") || "無"}`);
  lines.push("", "## 結局");
  for (const e of project.endings) {
    lines.push(`- ${e.title}（${e.id}）：${e.text}`);
    for (const x of e.epilogues ?? []) lines.push(`  - 尾聲（若 ${describeCondition(project, x.condition)}）：${x.text}`);
  }
  lines.push("", "## 共用事件");
  for (const c of project.commonEvents) {
    lines.push(`### ${c.name}（${c.id}，${c.trigger === "autorun" ? `開關 ${c.switchId} ON 時自動執行` : "被呼叫時執行"}）`);
    lines.push(...describeCommandList(project, c.commands));
  }
  lines.push("", "## 地圖與事件");
  for (const m of project.maps) {
    if (onlyMaps && !onlyMaps.has(m.id)) {
      lines.push(`### ${m.name}（${m.id}）：省略（${m.events.length} 個事件）`);
      continue;
    }
    lines.push(`### ${m.name}（${m.id}，${m.width}×${m.height}${m.parentId ? `，上層 ${m.parentId}` : ""}）`);
    for (const e of m.events) {
      lines.push(`#### 事件「${e.name}」（${e.id}）@ (${e.x},${e.y})${e.note ? `｜${e.note}` : ""}`);
      e.pages.forEach((pg, i) => {
        lines.push(`第 ${i + 1} 頁｜條件：${describePageConditions(project, pg)}｜${TRIGGER_LABEL[pg.trigger]}｜${PRIORITY_LABEL[pg.priority]}｜圖像：${pg.graphic?.assetId ?? "無"}`);
        lines.push(...describeCommandList(project, pg.commands, "  "));
      });
    }
  }
  if (playtest) {
    lines.push("", "## 自動試玩找到的最短通關路線");
    for (const g of playtest.goals) lines.push(`- ${g.title}：${g.reachable ? g.steps!.join(" → ") : "無法達成"}`);
  }
  return lines.join("\n");
}

export type ReviewContext = { previous?: ReviewResult | null; lessons?: string | null };

function contextBlocks(ctx: ReviewContext = {}) {
  const parts: string[] = [];
  if (ctx.previous) {
    const r = ctx.previous.review;
    parts.push(
      `<previous_review>\n上一輪：總分 ${r.overall}，${ctx.previous.passed ? "通過" : "退回"}。\n${r.issues.map((i, n) => `${n + 1}. [${i.severity}] ${i.area}：${i.problem}`).join("\n")}\n</previous_review>`,
    );
  }
  if (ctx.lessons?.trim()) parts.push(`<lessons>\n${ctx.lessons.trim().slice(0, 6000)}\n</lessons>`);
  return parts.length ? `${parts.join("\n\n")}\n\n` : "";
}

/** 審查摘要的長度上限；超過時只保留章節路線經過的地圖 */
const MAX_DIGEST = 120_000;

const predictionSchema = z.strictObject({
  guesses: z.array(z.strictObject({ about: z.string().max(60), guess: z.string().max(300) })).min(3).max(8),
  feelsLike: z.array(z.string().max(120)).max(5),
});
export type BlindPrediction = z.infer<typeof predictionSchema>;

const PREDICTOR_PROMPT = `你是玩過上百款 RPG、看過大量小說與電影的老玩家。你只讀到一份 RPG 劇本大綱的開頭（玩家在第 1 章結束前會知道的事）。
請在 guesses 寫下你對後面劇情的具體猜測：中段的翻轉、主要角色的秘密、反派或衝突的真相、結局會怎麼收。寫得越具體越好，不要寫模糊的「會有轉折」。
在 feelsLike 寫出它讓你想到的既有套路或作品類型（例如「失憶主角最後發現自己是反派」）；沒有就給空陣列。
所有文字使用繁體中文（台灣用語）。`;

/** 盲猜測試：只看劇透線以上的內容，猜後面的劇情。猜中越多，故事越好猜 */
export async function blindPredict(provider: StoryProvider, treatment: string): Promise<BlindPrediction | null> {
  const cut = treatment.indexOf(SPOILER_LINE);
  if (cut < 0) return null;
  const raw = await provider.generateJson({ systemPrompt: PREDICTOR_PROMPT, prompt: `<opening>\n${treatment.slice(0, cut)}\n</opening>\n\n請寫下你的猜測。`, jsonSchema: toCliJsonSchema(predictionSchema) });
  return predictionSchema.parse(raw);
}

/** 劇本大綱審查（動工前）：先做盲猜測試，再把猜測交給審查員對照 */
export async function reviewTreatment(provider: StoryProvider, story: string, treatment: string, ctx: ReviewContext = {}): Promise<ReviewResult> {
  const prediction = await blindPredict(provider, treatment);
  const blind = prediction
    ? `<blind_predictions>\n另一位只讀到劇透線以上內容的老玩家，對後面劇情的猜測：\n${prediction.guesses.map((g, i) => `${i + 1}. ${g.about}：${g.guess}`).join("\n")}\n他覺得像：${prediction.feelsLike.join("、") || "（沒有）"}\n請對照完整大綱：核心翻轉或主要秘密被猜中（大致方向相同就算），surprise 最多 5 分；全部沒猜中，而且回頭看有伏筆可循，surprise 才能給 8 分以上。在 summary 說明哪些被猜中。\n</blind_predictions>\n\n`
    : `<blind_predictions>\n這份大綱沒有劇透線（${SPOILER_LINE}），無法做盲猜測試。請自己判斷故事有多好猜，並在 issues 提醒製作端加上劇透線。\n</blind_predictions>\n\n`;
  const prompt = `${contextBlocks(ctx)}${blind}<story>\n${story}\n</story>\n\n<treatment>\n${treatment}\n</treatment>\n\n請審查這份劇本大綱並輸出評分結果。`;
  const raw = await provider.generateJson({ systemPrompt: TREATMENT_SYSTEM_PROMPT, prompt, jsonSchema: toCliJsonSchema(treatmentReviewSchema) });
  const review = treatmentReviewSchema.parse(raw);
  const reasons = judge(review);
  return { kind: "treatment", target: "treatment", passed: reasons.length === 0, review, reasons, prediction, reviewedAt: new Date().toISOString() };
}

/**
 * 章節審查（chapter 有值）或整體審查。
 * 章節審查只評這一章（其他章節是背景），並附上這一章從測試起點到下一章的自動試玩路線與時長。
 */
export async function reviewProject(
  provider: StoryProvider,
  input: {
    story: string;
    treatment?: string;
    project: GameProject;
    playtest: PlaytestReport;
    quality: QualityReport;
    revision: string;
    chapter?: { index: number; route: string[] | null; minutes: [number, number] | null; mapIds?: string[] };
  } & ReviewContext,
): Promise<ReviewResult> {
  const { story, treatment, project, playtest, quality, chapter } = input;
  let digest = projectDigest(project, playtest);
  if (digest.length > MAX_DIGEST && chapter?.mapIds?.length) digest = projectDigest(project, playtest, new Set(chapter.mapIds));
  const ch = chapter ? project.chapters[chapter.index] : undefined;
  const focus = ch
    ? `<focus>\n這次只審查第 ${chapter!.index + 1} 章「${ch.title}」（${ch.summary ?? ""}）。其他章節只當作背景，不要因為其他章節還沒完成而扣分；但要評估這一章和前後章節的銜接（H2 章末鉤子、H4 伏筆）。\n這一章從測試起點到${chapter!.index + 1 < project.chapters.length ? "下一章" : "結局"}的最短路線：${chapter!.route?.join(" → ") ?? "（找不到路線）"}\n預估這一章的遊玩時間：${chapter!.minutes ? `${chapter!.minutes[0]}～${chapter!.minutes[1]} 分鐘` : "未知"}\n</focus>\n\n`
    : "";
  const prompt = `${contextBlocks(input)}${focus}<story>\n${story}\n</story>\n\n${treatment ? `<treatment>\n${treatment}\n</treatment>\n\n` : ""}<game>\n${digest}\n</game>\n\n<metrics>\n${JSON.stringify(quality.metrics)}\n</metrics>\n\n請審查${ch ? "這一章" : "這款遊戲"}並輸出評分結果。`;
  const raw = await provider.generateJson({ systemPrompt: REVIEW_SYSTEM_PROMPT, prompt, jsonSchema: toCliJsonSchema(reviewSchema) });
  const review = reviewSchema.parse(raw);
  const reasons = judge(review);
  return { kind: ch ? "chapter" : "full", target: ch?.id ?? "full", revision: input.revision, passed: reasons.length === 0, review, reasons, reviewedAt: new Date().toISOString() };
}
