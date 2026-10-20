import { z } from "zod";
import { describeCondition, describeEffect } from "@/game/describe";
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

/** 把 GameProject 轉成審查員容易閱讀的劇本摘要 */
export function projectDigest(project: GameProject, playtest: PlaytestReport): string {
  const lines: string[] = [`# ${project.title}（${project.genre}）`, project.description, project.intro ?? "", ""];
  lines.push("## 場景");
  for (const s of project.scenes) {
    const pickups = (s.pickups ?? []).map((p) => `${project.items.find((i) => i.id === p.itemId)?.name ?? p.itemId}${p.condition ? `（出現條件：${describeCondition(project, p.condition)}）` : ""}`);
    const exits = s.exits.map((e) => `往 ${e.targetSceneId}`);
    lines.push(`- ${s.name}（${s.id}）：NPC ${s.npcIds.join("、") || "無"}；地點 ${(s.locations ?? []).map((l) => l.name).join("、") || "無"}；地上可撿 ${pickups.join("、") || "無"}；出口 ${exits.join("、") || "無"}`);
  }
  lines.push("", "## NPC");
  for (const n of project.npcs) {
    lines.push(`- ${n.name}（${n.id}）：${n.description}；預設對話 ${n.dialogueNodeId}`);
    for (const v of n.dialogueVariants ?? []) lines.push(`  - 若 ${describeCondition(project, v.condition)} → ${v.dialogueNodeId}`);
  }
  lines.push("", "## 對話");
  for (const d of project.dialogues) {
    lines.push(`- [${d.id}] ${d.speaker}：「${d.text}」`);
    for (const c of d.choices ?? []) {
      const effects = (c.effects ?? []).map((e) => describeEffect(project, e)).join("；");
      lines.push(`  - 選項「${c.text}」→ ${c.nextNodeId ?? "結束對話"}${effects ? `（${effects}）` : ""}${c.condition ? `［條件：${describeCondition(project, c.condition)}］` : ""}`);
    }
  }
  lines.push("", "## 任務");
  for (const q of project.quests) {
    lines.push(`- ${q.title}：${q.description}${q.startCondition ? `（開始條件：${describeCondition(project, q.startCondition)}）` : ""}`);
    q.objectives.forEach((o, i) => lines.push(`  ${i + 1}. ${o.description}`));
    if (q.rewards?.length) lines.push(`  完成獎勵：${q.rewards.map((r) => describeEffect(project, r)).join("；")}`);
  }
  lines.push("", "## 物品");
  for (const i of project.items) lines.push(`- ${i.name}（${i.id}）：${i.description}`);
  lines.push(`玩家初始物品：${project.player.inventoryItemIds.join("、") || "無"}`);
  lines.push("", "## 結局");
  for (const e of project.endings) lines.push(`- ${e.title}（條件：${describeCondition(project, e.condition)}）：${e.text}`);
  lines.push("", "## 自動試玩找到的最短通關路線");
  for (const e of playtest.endings) lines.push(`- ${e.title}：${e.reachable ? e.steps!.join(" → ") : "無法達成"}`);
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
