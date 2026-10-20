import { rmSync } from "node:fs";

/**
 * 讓前台與後台的部署內容彼此獨立：
 * - player：移除後台頁面（/studio）
 * - studio：移除前台頁面（/、/play），後台 Worker 會把 / 導向 /studio/
 */
const site = process.argv[2];
const remove = site === "player" ? ["out/studio"] : site === "studio" ? ["out/play", "out/index.html", "out/index.txt"] : null;
if (!remove) {
  console.error("用法：tsx scripts/prune-build.ts player|studio");
  process.exit(1);
}
for (const p of remove) rmSync(p, { recursive: true, force: true });
console.log(`已移除 ${site === "player" ? "後台" : "前台"}頁面：${remove.join("、")}`);
