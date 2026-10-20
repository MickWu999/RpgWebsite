import { z } from "zod";
import { describeCommandList, describeCondition, describePageConditions, PRIORITY_LABEL, TRIGGER_LABEL } from "@/game/describe";
import type { PlaytestReport } from "@/game/playtest";
import type { QualityReport } from "@/game/quality";
import type { GameProject } from "@/game/schema";
import { toCliJsonSchema } from "./outputSchema";
import type { StoryProvider } from "./provider";
import { DESIGN_GUIDE, REVIEW_RUBRIC } from "./designGuide";

/**
 * 自動 review 第二層：獨立的 AI 審查員。
 * - 與生成端分開呼叫，看不到生成過程，只看故事原文、遊戲內容摘要與自動試玩路線。
 * - 依固定評分標準打分；是否通過由程式依分數規則判定（不採信 AI 自己的 verdict）。
 */

export const reviewSchema = z.strictObject({
  scores: z.strictObject({
    fidelity: z.number().int().min(1).max(10),
    structure: z.number().int().min(1).max(10),
    choices: z.number().int().min(1).max(10),
    quests: z.number().int().min(1).max(10),
    characters: z.number().int().min(1).max(10),
    pacing: z.number().int().min(1).max(10),
    endings: z.number().int().min(1).max(10),
    feedback: z.number().int().min(1).max(10),
  }),
  overall: z.number().int().min(1).max(10),
  summary: z.string().max(600),
  issues: z
    .array(
      z.strictObject({
        severity: z.enum(["critical", "major", "minor"]),
        area: z.string().max(40),
        problem: z.string().max(400),
        suggestion: z.string().max(400),
      }),
    )
    .max(12),
});
export type AiReview = z.infer<typeof reviewSchema>;

export const REVIEW_PASS_RULE = { minOverall: 7, minEachScore: 6, maxMajorIssues: 1 };

export type ReviewResult = { passed: boolean; review: AiReview; reasons: string[] };

const REVIEW_SYSTEM_PROMPT = `你是獨立的 RPG 品質審查員，負責判斷一份由 AI 生成的 2D RPG 是否達到可以直接發布的品質。
你沒有參與生成，請只根據提供的「故事原文」、「遊戲內容」與「自動試玩路線」嚴格評分，不要假設沒有提供的內容。
程式已經驗證過資料格式、引用與結局可達性，請不要重複檢查這些，專注在內容品質。

以下是本平台採用的敘事設計準則（生成端也照這份準則設計）：
${DESIGN_GUIDE}

${REVIEW_RUBRIC}

問題的嚴重度：critical = 不修改就不能發布；major = 明顯影響體驗；minor = 可以更好。
每個問題都要具體指出位置（NPC、對話節點 ID、任務或結局）並給出可以直接執行的修改建議。
所有文字使用繁體中文（台灣用語）。`;

/** 把 GameProject 轉成審查員（與 AI agent）容易閱讀的 RPG Maker 式摘要：資料庫＋每個事件頁的執行內容 */
export function projectDigest(project: GameProject, playtest: PlaytestReport | null): string {
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

export async function reviewProject(
  provider: StoryProvider,
  story: string,
  project: GameProject,
  playtest: PlaytestReport,
  quality: QualityReport,
): Promise<ReviewResult> {
  const prompt = `<story>
${story}
</story>

<game>
${projectDigest(project, playtest)}
</game>

<metrics>
${JSON.stringify(quality.metrics)}
</metrics>

請審查這款遊戲並輸出評分結果。`;
  const raw = await provider.generateJson({ systemPrompt: REVIEW_SYSTEM_PROMPT, prompt, jsonSchema: toCliJsonSchema(reviewSchema) });
  const review = reviewSchema.parse(raw);
  const reasons: string[] = [];
  if (review.overall < REVIEW_PASS_RULE.minOverall) reasons.push(`總分 ${review.overall} 低於 ${REVIEW_PASS_RULE.minOverall}`);
  for (const [k, v] of Object.entries(review.scores)) if (v < REVIEW_PASS_RULE.minEachScore) reasons.push(`${k} 只有 ${v} 分`);
  const critical = review.issues.filter((i) => i.severity === "critical").length;
  if (critical > 0) reasons.push(`有 ${critical} 個 critical 問題`);
  const major = review.issues.filter((i) => i.severity === "major").length;
  if (major > REVIEW_PASS_RULE.maxMajorIssues) reasons.push(`有 ${major} 個 major 問題（最多 ${REVIEW_PASS_RULE.maxMajorIssues} 個）`);
  return { passed: reasons.length === 0, review, reasons };
}
