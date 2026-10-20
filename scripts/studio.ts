import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runPlaytest } from "@/game/playtest";
import { assessQuality } from "@/game/quality";
import { validateProject } from "@/game/validate";
import { applyOps, opSchema } from "@/studio/ops";
import { z } from "zod";

/**
 * Studio 操作 API 的命令列入口（給 AI 使用，與 Studio 介面同一套操作）：
 *   npm run studio -- <project.json> <ops.json> [--write] [--playtest]
 *   npm run studio -- --schema            # 輸出操作的 JSON Schema
 * ops.json 是操作陣列；預設只試算不寫檔，加 --write 才寫回 project.json。
 * 輸出 JSON：{ results, report, playtest?, quality? }；結束碼 0＝全部操作成功且驗證通過。
 */

const { values, positionals } = parseArgs({ allowPositionals: true, options: { write: { type: "boolean" }, playtest: { type: "boolean" }, schema: { type: "boolean" } } });
if (values.schema) {
  console.log(JSON.stringify(z.toJSONSchema(z.array(opSchema)), null, 2));
  process.exit(0);
}
const [projectFile, opsFile] = positionals;
if (!projectFile || !opsFile) {
  console.error("用法：npm run studio -- <project.json> <ops.json> [--write] [--playtest]");
  process.exit(1);
}
const base = validateProject(JSON.parse(readFileSync(projectFile, "utf8")));
if (!base.project) {
  console.log(JSON.stringify({ ok: false, stage: "base", errors: base.errors }, null, 2));
  process.exit(2);
}
const ops = JSON.parse(readFileSync(opsFile, "utf8"));
const result = applyOps(base.project, Array.isArray(ops) ? ops : [ops]);
const allOk = result.results.every((r) => r.ok);
const playtest = values.playtest && result.report.isValid ? runPlaytest(result.project) : undefined;
const quality = playtest ? assessQuality(result.project, playtest) : undefined;
if (values.write && allOk && result.report.isValid) writeFileSync(projectFile, JSON.stringify(result.project, null, 2) + "\n");
console.log(JSON.stringify({ ok: allOk && result.report.isValid, written: Boolean(values.write && allOk && result.report.isValid), results: result.results, report: result.report, playtest, quality }, null, 2));
process.exit(allOk && result.report.isValid ? 0 : 2);
