import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { coverDataOf } from "@/game/cover";
import { projectRevision } from "@/game/engine";
import { runPlaytest } from "@/game/playtest";
import { assessQuality } from "@/game/quality";
import { validateProject } from "@/game/validate";
import type { CatalogEntry } from "@/lib/packs";

/**
 * 產生遊戲庫目錄 public/games/index.json。
 * 只收錄同時符合以下條件的模組包：通過驗證、通過自動試玩、沒有品質指標的 blocking 問題、
 * meta.json 的 status 為 demo 或 approved（needs_human_review 不會被收錄）。
 *   npm run catalog
 */

const GAMES_DIR = path.join("public", "games");
const games: CatalogEntry[] = [];
let skipped = 0;

for (const dir of readdirSync(GAMES_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const projectFile = path.join(GAMES_DIR, dir, "project.json");
  const metaFile = path.join(GAMES_DIR, dir, "meta.json");
  if (!existsSync(projectFile)) continue;
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : {};
  const skip = (reason: string) => {
    skipped++;
    console.log(`  ✗ ${dir}：${reason}，未收錄`);
  };
  if (meta.status !== "demo" && meta.status !== "approved") {
    skip(`狀態為「${meta.status ?? "未知"}」`);
    continue;
  }
  const validation = validateProject(JSON.parse(readFileSync(projectFile, "utf8")));
  if (!validation.project) {
    skip(`驗證失敗：${validation.errors[0]?.message}`);
    continue;
  }
  const project = validation.project;
  if (project.id !== dir) {
    skip(`資料夾名稱與專案 ID「${project.id}」不一致`);
    continue;
  }
  const playtest = runPlaytest(project);
  if (!playtest.ok) {
    skip(`自動試玩失敗：${playtest.issues[0]?.message ?? "狀態過多"}`);
    continue;
  }
  const quality = assessQuality(project, playtest, { checkDuration: meta.status !== "demo" });
  if (playtest.truncated) console.log(`  ⚠ ${dir}：狀態太多，自動試玩探索 ${playtest.statesExplored} 個後截斷，卡死偵測不完整`);
  if (quality.blocking.length > 0) {
    skip(`品質指標未達標：${quality.blocking[0].message}`);
    continue;
  }
  games.push({
    id: project.id,
    title: project.title,
    description: project.description,
    genre: project.genre,
    status: meta.status,
    endings: project.endings.length,
    achievements: (project.achievements ?? []).length + project.endings.filter((e) => !e.nextChapterId).length,
    npcs: quality.metrics.people,
    chapters: project.chapters.length,
    release: project.release?.status ?? "complete",
    plannedChapters: project.release?.plannedChapters,
    typicalMinutes: quality.metrics.duration?.typicalMinutes ?? null,
    cover: coverDataOf(project),
    path: `/games/${dir}/project.json`,
    revision: projectRevision(project),
  });
  console.log(`  ✓ ${dir}：${project.title}（${meta.status}，約 ${quality.metrics.duration?.typicalMinutes.join("～")} 分鐘）`);
}

writeFileSync(path.join(GAMES_DIR, "index.json"), JSON.stringify({ generatedAt: new Date().toISOString(), games }, null, 2) + "\n");
console.log(`遊戲目錄：收錄 ${games.length} 款，略過 ${skipped} 款 → ${path.join(GAMES_DIR, "index.json")}`);
