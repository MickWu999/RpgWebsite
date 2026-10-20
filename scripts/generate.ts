import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { generateProject, providerFromEnv } from "@/ai/pipeline";
import { validateProject } from "@/game/validate";
import { loadLocalEnv } from "./env";

/**
 * 命令列生成：npm run generate -- <故事檔.txt> [--title 名稱] [--genre fantasy|modern|sci-fi|mystery] [--style 冒險] [--out 檔案] [--json] [--no-review] [--publish] [--from 既有遊戲.json]
 * 流程：本機 Claude Code 生成 → 驗證 → 自動試玩 → 修復 → 品質指標 → 獨立 AI 審查 → 依意見修改，全程不需人工介入。
 * 結束碼：0 = approved（可直接發布）；3 = needs_human_review／unreviewed（能玩但未通過品質審查）；2 = 失敗。
 * --json 會在 stdout 輸出完整結果（含驗證報告、試玩路線與每次嘗試的錯誤），進度訊息改輸出到 stderr。
 * --from：從既有遊戲開始改進（例如規則更新後補齊缺少的內容），保留原本的專案 ID。
 * --publish：只有 approved 的結果會寫成模組包 public/games/<id>/ 並重建遊戲目錄（needs_human_review 不會發布）。
 * 產出的 JSON 也可在網站首頁「匯入 JSON」載入試玩。
 */

loadLocalEnv();
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    title: { type: "string" },
    genre: { type: "string" },
    style: { type: "string" },
    out: { type: "string" },
    json: { type: "boolean" },
    "no-review": { type: "boolean" },
    publish: { type: "boolean" },
    from: { type: "string" },
  },
});
if (positionals.length === 0) {
  console.error("用法：npm run generate -- <故事檔.txt> [--title 名稱] [--genre fantasy] [--style 冒險] [--out generated/x.json]");
  process.exit(1);
}

async function main() {
  const story = readFileSync(positionals[0], "utf8");
  const from = values.from ? validateProject(JSON.parse(readFileSync(values.from, "utf8"))).project : undefined;
  if (values.from && !from) throw new Error(`--from 指定的檔案未通過驗證：${values.from}`);
  const projectId = from?.id ?? `rpg-${Date.now().toString(36)}`;
  const log = values.json ? (m: string) => console.error(m) : (m: string) => console.log(m);
  const result = await generateProject(
    providerFromEnv(),
    { story, projectId, title: values.title, genre: values.genre, style: values.style },
    (m) => log(`… ${m}`),
    { review: !values["no-review"], from },
  );
  const exitCode = result.status === "approved" || result.status === "fixture" ? 0 : result.project ? 3 : 2;
  const out = values.out ?? path.join("generated", `${projectId}.json`);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(result.project ?? result.rawProject, null, 2) + "\n");

  if (values.publish) {
    if (result.status === "approved" && result.project) {
      const dir = path.join("public", "games", result.project.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "project.json"), JSON.stringify(result.project, null, 2) + "\n");
      writeFileSync(
        path.join(dir, "meta.json"),
        JSON.stringify({ status: "approved", source: "ai", provider: result.provider, review: result.review?.review.overall, publishedAt: new Date().toISOString() }, null, 2) + "\n",
      );
      log(`已發布模組包：${dir}`);
      execFileSync(process.execPath, [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("scripts", "build-catalog.ts")], { stdio: values.json ? "ignore" : "inherit" });
    } else {
      log(`狀態為 ${result.status}，不發布（只有 approved 會自動發布）`);
    }
  }

  if (values.json) {
    console.log(JSON.stringify({ ok: result.status === "approved", outFile: out, ...result, rawProject: undefined }, null, 2));
    process.exit(exitCode);
  }

  const kindLabel = { generate: "生成", repair: "修復", revise: "依審查修改" };
  for (const a of result.attempts) {
    console.log(`第 ${a.attempt} 次（${kindLabel[a.kind]}）：${a.errors.length} 個錯誤`);
    a.notes.forEach((n) => console.log(`  正規化：${n}`));
    a.errors.slice(0, 10).forEach((e) => console.log(`  ✗ ${e.path}：${e.message}`));
  }
  result.report.warnings.forEach((w) => console.log(`  ⚠ ${w.path}：${w.message}`));
  for (const e of result.playtest?.endings ?? []) console.log(`  ${e.reachable ? "✓" : "✗"} 結局「${e.title}」${e.reachable ? `可達成（${e.steps!.length} 步）` : "找不到路線"}`);
  if (result.quality) console.log(`品質指標：${JSON.stringify(result.quality.metrics)}`);
  if (result.review) {
    const r = result.review.review;
    console.log(`AI 審查：總分 ${r.overall}/10 ${JSON.stringify(r.scores)}${result.review.passed ? "，通過" : `，未通過：${result.review.reasons.join("、")}`}`);
    console.log(`  ${r.summary}`);
    r.issues.forEach((i) => console.log(`  ［${i.severity}］${i.area}：${i.problem}`));
  }
  console.log(`狀態：${result.status}。${result.message}`);
  console.log(`${result.project ? "已輸出" : "已輸出（未通過驗證，供檢視）"}：${out}`);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(`生成失敗：${(e as Error).message}`);
  process.exit(2);
});
