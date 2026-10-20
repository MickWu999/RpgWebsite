import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import demoFixture from "../public/games/demo-lantern/project.json";
import { runPlaytest } from "@/game/playtest";
import { assessQuality } from "@/game/quality";
import { validateProject } from "@/game/validate";

/**
 * 給 AI／自動化流程使用的檢查指令：schema 驗證 → 邏輯驗證 → 自動試玩 → 量化品質指標（不使用 AI）。
 *   npm run validate -- <project.json|demo> [--json]
 * 結束碼：0 = 全部通過；1 = 用法錯誤；2 = 驗證、自動試玩或品質指標未通過。
 * --json 會輸出單一 JSON 物件：{ ok, validation: {isValid, errors, warnings}, playtest, quality }
 */

const { values, positionals } = parseArgs({ allowPositionals: true, options: { json: { type: "boolean" } } });
const target = positionals[0];
if (!target) {
  console.error("用法：npm run validate -- <project.json|demo> [--json]");
  process.exit(1);
}

let input: unknown;
try {
  input = target === "demo" ? demoFixture : JSON.parse(readFileSync(target, "utf8"));
} catch (e) {
  const out = { ok: false, validation: { isValid: false, errors: [{ path: "", message: `無法讀取 JSON：${(e as Error).message}` }], warnings: [] }, playtest: null };
  console.log(values.json ? JSON.stringify(out, null, 2) : out.validation.errors[0].message);
  process.exit(2);
}

const validation = validateProject(input);
const playtest = validation.project ? runPlaytest(validation.project) : null;
const quality = validation.project && playtest ? assessQuality(validation.project, playtest) : null;
const ok = validation.isValid && Boolean(playtest?.ok) && quality?.blocking.length === 0;
const result = {
  ok,
  validation: { isValid: validation.isValid, errors: validation.errors, warnings: validation.warnings },
  playtest,
  quality,
};

if (values.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`驗證：${validation.isValid ? "通過" : `失敗（${validation.errors.length} 個錯誤）`}，警告 ${validation.warnings.length} 個`);
  validation.errors.forEach((e) => console.log(`  ✗ ${e.path}：${e.message}`));
  validation.warnings.forEach((w) => console.log(`  ⚠ ${w.path}：${w.message}`));
  if (playtest) {
    console.log(`自動試玩：${playtest.ok ? "通過" : "失敗"}（探索 ${playtest.statesExplored} 個狀態${playtest.truncated ? "，已達上限被截斷" : ""}）`);
    for (const e of playtest.endings) {
      console.log(`  ${e.reachable ? "✓" : "✗"} ${e.title}${e.reachable ? `（${e.steps!.length} 步）` : "：找不到路線"}`);
      e.steps?.forEach((s, i) => console.log(`      ${i + 1}. ${s}`));
    }
    playtest.issues.forEach((i) => console.log(`  ✗ ${i.message}`));
  }
  if (quality) {
    console.log(`品質指標：${quality.blocking.length === 0 ? "通過" : `未達標（${quality.blocking.length} 項）`}`);
    console.log(`  ${JSON.stringify(quality.metrics)}`);
    quality.blocking.forEach((b) => console.log(`  ✗ ${b.message}`));
    quality.suggestions.forEach((b) => console.log(`  ・建議：${b.message}`));
  }
}
process.exit(ok ? 0 : 2);
