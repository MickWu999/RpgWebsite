import { z } from "zod";
import { DESIGN_GUIDE } from "./designGuide";
import { toCliJsonSchema } from "./outputSchema";
import type { StoryPreferences } from "./prompt";
import type { StoryProvider } from "./provider";

/**
 * 劇本大綱（treatment）：生成遊戲資料之前，先把使用者的故事擴寫成結構化大綱。
 * 角色動機、章節轉折、支線與結局意義在這一步先想清楚，遊戲資料再照大綱實作，
 * 這樣 25～40 分鐘的長度是靠劇情撐起來，而不是靠來回跑腿灌水。
 */

export const treatmentSchema = z.strictObject({
  logline: z.string().max(200),
  themes: z.array(z.string().max(40)).max(4),
  characters: z
    .array(
      z.strictObject({
        name: z.string().max(40),
        role: z.string().max(80),
        desire: z.string().max(160),
        secret: z.string().max(200),
        speechStyle: z.string().max(120),
      }),
    )
    .min(4)
    .max(10),
  chapters: z
    .array(
      z.strictObject({
        title: z.string().max(40),
        goal: z.string().max(200),
        locations: z.array(z.string().max(40)).max(4),
        beats: z.array(z.string().max(200)).min(3).max(8),
        twist: z.string().max(240),
        keyChoice: z.string().max(240),
      }),
    )
    .min(3)
    .max(4),
  sideQuests: z
    .array(z.strictObject({ title: z.string().max(40), giver: z.string().max(40), hook: z.string().max(200), payoff: z.string().max(200) }))
    .min(1)
    .max(3),
  endings: z
    .array(z.strictObject({ title: z.string().max(40), requires: z.string().max(240), meaning: z.string().max(240) }))
    .min(2)
    .max(4),
});
export type Treatment = z.infer<typeof treatmentSchema>;

const TREATMENT_SYSTEM_PROMPT = `你是敘事型 RPG 的首席編劇。請把使用者提供的故事擴寫成一份可以做成 25～40 分鐘 2D RPG 的劇本大綱。
規則：
1. 忠於原作的角色、世界觀與核心衝突；原作沒寫到的部分，補上合理且有戲劇性的細節，不要偏離主題。
2. 3 章主線，每章都要有明確目標、3～8 個劇情節拍、一個改變局勢的轉折，以及一個玩家的關鍵抉擇。
3. 每個角色都要有「想要什麼」與「隱藏的秘密」，秘密要在某一章被揭露或成為抉擇的依據；說話風格要能讓人分辨。
4. 1～3 條支線，支線要和主題相關，結果會影響尾聲或結局。
5. 2～4 個結局，各由不同的抉擇組合決定，意義各不相同（誰得到什麼、付出什麼），不能只是好壞版本。
6. 劇情的份量來自揭露、抉擇與角色關係，不要用重複的跑腿或收集灌水。
7. 所有文字使用繁體中文（台灣用語）。只輸出符合 schema 的資料。

${DESIGN_GUIDE}`;

export async function writeTreatment(provider: StoryProvider, story: string, prefs: StoryPreferences): Promise<Treatment> {
  const prompt = `<preferences>
專案名稱：${prefs.title || "（請依故事命名）"}
類型：${prefs.genre || "依故事判斷"}
敘事風格：${prefs.style || "依故事判斷"}
</preferences>

<story>
${story}
</story>

請寫出劇本大綱。`;
  const raw = await provider.generateJson({ systemPrompt: TREATMENT_SYSTEM_PROMPT, prompt, jsonSchema: toCliJsonSchema(treatmentSchema) });
  return treatmentSchema.parse(raw);
}

/** 給生成 prompt 使用的大綱文字 */
export function treatmentText(t: Treatment): string {
  const lines = [`一句話：${t.logline}`, `主題：${t.themes.join("、")}`, "", "角色："];
  for (const c of t.characters) lines.push(`- ${c.name}（${c.role}）想要：${c.desire}；秘密：${c.secret}；說話風格：${c.speechStyle}`);
  t.chapters.forEach((ch, i) => {
    lines.push("", `第 ${i + 1} 章「${ch.title}」：${ch.goal}（地點：${ch.locations.join("、")}）`);
    ch.beats.forEach((b, j) => lines.push(`  ${j + 1}. ${b}`));
    lines.push(`  轉折：${ch.twist}`, `  關鍵抉擇：${ch.keyChoice}`);
  });
  lines.push("", "支線：");
  for (const q of t.sideQuests) lines.push(`- ${q.title}（委託人：${q.giver}）${q.hook} → ${q.payoff}`);
  lines.push("", "結局：");
  for (const e of t.endings) lines.push(`- ${e.title}：條件 ${e.requires}；意義 ${e.meaning}`);
  return lines.join("\n");
}
