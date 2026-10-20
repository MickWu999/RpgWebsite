import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { providerFromEnv } from "@/ai/pipeline";
import { reviewProject } from "@/ai/review";
import { runPlaytest } from "@/game/playtest";
import { assessQuality } from "@/game/quality";
import { validateProject } from "@/game/validate";
import { loadLocalEnv } from "./env";

/**
 * 對既有專案執行完整審查（驗證 → 自動試玩 → 品質指標 → 獨立 AI 審查）：
 *   npm run review -- <project.json> --story <故事檔.txt> [--json]
 * 結束碼：0 = 通過；2 = 驗證／試玩失敗；3 = 品質或 AI 審查未通過。
 */

loadLocalEnv();
const { values, positionals } = parseArgs({ allowPositionals: true, options: { story: { type: "string" }, json: { type: "boolean" } } });
if (!positionals[0] || !values.story) {
  console.error("用法：npm run review -- <project.json> --story <故事檔.txt> [--json]");
  process.exit(1);
}

async function main() {
  const validation = validateProject(JSON.parse(readFileSync(positionals[0], "utf8")));
  if (!validation.project) {
    console.log(JSON.stringify({ ok: false, stage: "validation", errors: validation.errors }, null, 2));
    process.exit(2);
  }
  const playtest = runPlaytest(validation.project);
  if (!playtest.ok) {
    console.log(JSON.stringify({ ok: false, stage: "playtest", issues: playtest.issues }, null, 2));
    process.exit(2);
  }
  const quality = assessQuality(validation.project, playtest);
  const provider = providerFromEnv();
  const status = provider ? await provider.available() : { ok: false, detail: "AI_PROVIDER=none" };
  if (!provider || !status.ok) throw new Error(`AI 不可用：${status.detail}`);
  const review = await reviewProject(provider, readFileSync(values.story!, "utf8"), validation.project, playtest, quality);
  const ok = quality.blocking.length === 0 && review.passed;
  if (values.json) console.log(JSON.stringify({ ok, quality, review }, null, 2));
  else {
    console.log(`品質指標：${quality.blocking.length === 0 ? "通過" : quality.blocking.map((b) => b.message).join("；")}`);
    console.log(`AI 審查：總分 ${review.review.overall}/10 ${JSON.stringify(review.review.scores)}，${review.passed ? "通過" : `未通過：${review.reasons.join("、")}`}`);
    console.log(review.review.summary);
    review.review.issues.forEach((i) => console.log(`  ［${i.severity}］${i.area}：${i.problem}\n     → ${i.suggestion}`));
  }
  process.exit(ok ? 0 : 3);
}

main().catch((e) => {
  console.error(`審查失敗：${(e as Error).message}`);
  process.exit(2);
});
