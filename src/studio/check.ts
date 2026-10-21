import { checkChapters } from "@/game/chapters";
import { projectRevision } from "@/game/engine";
import { lintDesign } from "@/game/lint";
import { runPlaytest } from "@/game/playtest";
import { assessQuality } from "@/game/quality";
import type { GameProject } from "@/game/schema";
import { validateProject } from "@/game/validate";

/**
 * 專案檢查（驗證＋設計防呆＋整體自動試玩＋每章自動試玩＋品質指標）。在瀏覽器或 AI 的本機 CLI 執行，不在伺服器執行：
 * 大型遊戲的自動試玩需要上千毫秒 CPU，會超過 Cloudflare Workers 免費方案的限制（實測 653ms 即被中止）。
 * 發布時把報告連同 revision（內容指紋）送給伺服器，伺服器只比對指紋是否符合目前內容。
 */
export type CheckReport = ReturnType<typeof runCheck>;

export function runCheck(project: GameProject, options: { demo?: boolean } = {}) {
  const revision = projectRevision(project);
  const validation = validateProject(project);
  if (!validation.project) {
    return { passed: false, revision, validation: { errors: validation.errors, warnings: validation.warnings }, lint: null, playtest: null, chapters: [], quality: null, typicalMinutes: null };
  }
  const lint = lintDesign(validation.project);
  const playtest = runPlaytest(validation.project);
  const chapters = checkChapters(validation.project);
  const quality = assessQuality(validation.project, playtest, { checkDuration: !options.demo, chapters });
  return {
    passed: playtest.ok && quality.blocking.length === 0 && lint.errors.length === 0,
    revision,
    validation: { errors: [] as typeof validation.errors, warnings: validation.warnings },
    lint,
    playtest: {
      ok: playtest.ok,
      truncated: playtest.truncated,
      statesExplored: playtest.statesExplored,
      issues: playtest.issues,
      endings: playtest.goals.map((e) => ({ title: e.title, reachable: e.reachable, steps: e.steps })),
    },
    chapters,
    quality,
    typicalMinutes: quality.metrics.duration?.typicalMinutes ?? null,
  };
}

/** 發布時送給伺服器的摘要 */
export function publishSummary(r: CheckReport) {
  return {
    revision: r.revision,
    valid: r.validation.errors.length === 0,
    playtestOk: Boolean(r.playtest?.ok),
    // 設計防呆的錯誤（卡關、永遠不會出現的事件頁）和品質指標一樣會擋下發布
    qualityBlocking: (r.quality?.blocking.length ?? 99) + (r.lint?.errors.length ?? 0),
    typicalMinutes: r.typicalMinutes,
  };
}

/** 在瀏覽器執行時先讓畫面更新（顯示「檢查中」），再進行運算 */
export function runCheckAsync(project: GameProject, options: { demo?: boolean } = {}) {
  return new Promise<CheckReport>((resolve) => setTimeout(() => resolve(runCheck(project, options)), 30));
}
