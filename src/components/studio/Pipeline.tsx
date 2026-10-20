"use client";

/**
 * AI 製作進度條：故事 → 大綱審查 → 各章（試玩＋審查）→ 整體審查 → 發布。
 * 卡片上用精簡版，專案總覽用完整版（含每章狀態與下一步）。
 */

export type StageState = "done" | "failed" | "active" | "todo";
export type Stage = { key: string; label: string; state: StageState; detail?: string };

export type PipelineInput = {
  hasStory: boolean;
  hasTreatment: boolean;
  /** null＝還沒審查過 */
  treatmentPassed: boolean | null;
  chapters: Array<{ title: string; reviewPassed: boolean | null; checkOk?: boolean }>;
  fullPassed: boolean | null;
  fullStale?: boolean;
  published: boolean;
};

export function stagesOf(p: PipelineInput): { stages: Stage[]; next: string } {
  const stages: Stage[] = [];
  const st = (ok: boolean | null, started: boolean): StageState => (ok === true ? "done" : ok === false ? "failed" : started ? "active" : "todo");
  stages.push({ key: "story", label: "故事", state: p.hasStory ? "done" : "active", detail: p.hasStory ? undefined : "寫下故事或題材" });
  stages.push({ key: "treatment", label: "大綱審查", state: st(p.treatmentPassed, p.hasTreatment), detail: p.treatmentPassed === false ? "沒通過，AI 正在修改大綱" : undefined });
  const total = p.chapters.length;
  const passed = p.chapters.filter((c) => c.reviewPassed).length;
  stages.push({
    key: "chapters",
    label: total ? `章節 ${passed}/${total}` : "章節",
    state: total === 0 ? (p.treatmentPassed ? "active" : "todo") : passed === total ? "done" : p.chapters.some((c) => c.reviewPassed === false) ? "failed" : "active",
  });
  stages.push({ key: "full", label: "整體審查", state: p.fullStale ? "failed" : st(p.fullPassed, total > 0 && passed === total), detail: p.fullStale ? "內容改過，需要重新審查" : undefined });
  stages.push({ key: "publish", label: "發布", state: p.published ? "done" : "todo" });

  let next = "已發布到玩家網站";
  if (!p.hasStory) next = "寫下故事或題材，交給 AI";
  else if (!p.hasTreatment) next = "等待 AI 撰寫劇本大綱";
  else if (!p.treatmentPassed) next = p.treatmentPassed === false ? "大綱審查沒通過：AI 依意見修改中" : "等待大綱審查";
  else if (total === 0) next = "AI 開始製作第 1 章";
  else if (passed < total) {
    const i = p.chapters.findIndex((c) => !c.reviewPassed);
    const c = p.chapters[i];
    next = c.reviewPassed === false ? `第 ${i + 1} 章審查沒通過：AI 依意見修改中` : `製作第 ${i + 1} 章「${c.title}」`;
  } else if (!p.fullPassed || p.fullStale) next = p.fullStale ? "內容改過，需要重新整體審查" : p.fullPassed === false ? "整體審查沒通過：AI 依意見修改中" : "等待整體審查";
  else if (!p.published) next = "可以發布";
  return { stages, next };
}

const ICON: Record<StageState, string> = { done: "✓", failed: "✗", active: "●", todo: "○" };

export default function Pipeline({ input, compact = false }: { input: PipelineInput; compact?: boolean }) {
  const { stages, next } = stagesOf(input);
  return (
    <div className={`pipeline${compact ? " compact" : ""}`} data-testid="pipeline">
      <div className="pipeline-track">
        {stages.map((s, i) => (
          <div key={s.key} className={`pipeline-stage ${s.state}`} title={s.detail}>
            <span className="pipeline-dot">{ICON[s.state]}</span>
            <span className="pipeline-label">{s.label}</span>
            {i < stages.length - 1 && <span className="pipeline-line" />}
          </div>
        ))}
      </div>
      <div className="pipeline-next small">
        <span className="muted">下一步：</span>
        {next}
      </div>
    </div>
  );
}
