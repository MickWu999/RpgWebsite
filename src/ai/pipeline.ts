import { projectFromFixture } from "@/game/fixtureProject";
import { runPlaytest, type PlaytestReport } from "@/game/playtest";
import { assessQuality, type QualityReport } from "@/game/quality";
import type { GameProject } from "@/game/schema";
import { validateProject, type ValidationIssue, type ValidationReport } from "@/game/validate";
import { ClaudeCodeProvider } from "./claudeCodeProvider";
import { aiProjectJsonSchema } from "./outputSchema";
import { generationPrompt, repairPrompt, revisePrompt, SYSTEM_PROMPT, type StoryPreferences } from "./prompt";
import { normalizeAiProject } from "./normalize";
import { ProviderError, type StoryProvider } from "./provider";
import { reviewProject, type ReviewResult } from "./review";
import { treatmentText, writeTreatment, type Treatment } from "./treatment";

/**
 * 故事 → GameProject 無人值守流程（SPEC §8.1）：
 *   生成 → 正規化 → 驗證 → 自動試玩 →（有限次修復）
 *   → 量化品質指標 → 獨立 AI 審查 →（有限輪依審查意見修改）
 * 最終狀態：
 *   approved            通過驗證、自動試玩、品質指標與 AI 審查，可直接發布
 *   needs_human_review  能玩但品質未達標（或審查失敗），不應自動發布
 *   invalid             修復後仍未通過驗證或自動試玩
 *   unreviewed          通過驗證與試玩，但未執行品質審查（--no-review 或 AI 修復）
 *   fixture             沒有可用的 AI，退回 demo fixture
 * 只在本機 Node 環境執行（scripts/ai-server.ts、scripts/generate.ts），不會打包進網站。
 */

export const MAX_STORY_CHARS = 8000;
export const MAX_REPAIR_ATTEMPTS = 2;
export const MAX_REVIEW_ROUNDS = 3;
const GENRES = ["fantasy", "modern", "sci-fi", "mystery"] as const;

export type PipelineStatus = "approved" | "needs_human_review" | "invalid" | "unreviewed" | "fixture";
export type GenerateRequest = StoryPreferences & { story: string; projectId: string };
export type AttemptLog = { attempt: number; kind: "generate" | "repair" | "revise"; errors: ValidationIssue[]; notes: string[] };
export type GenerateResponse = {
  status: PipelineStatus;
  source: "ai" | "fixture";
  provider: string | null;
  project: GameProject | null;
  /** 驗證失敗時保留最後一次的原始輸出，供檢視 */
  rawProject: unknown;
  report: ValidationReport;
  playtest: PlaytestReport | null;
  quality: QualityReport | null;
  review: ReviewResult | null;
  /** 生成前先寫好的劇本大綱 */
  treatment?: Treatment | null;
  attempts: AttemptLog[];
  message: string;
};
type Progress = (msg: string) => void;

export function checkStory(story: unknown): string {
  if (typeof story !== "string" || story.trim().length < 10) throw new ProviderError("故事內容至少需要 10 個字", "bad_output");
  if (story.length > MAX_STORY_CHARS) throw new ProviderError(`故事內容不可超過 ${MAX_STORY_CHARS} 字`, "bad_output");
  return story.trim();
}

export function fixtureResponse(req: GenerateRequest, reason: string): GenerateResponse {
  const genre = GENRES.find((g) => g === req.genre);
  const project = projectFromFixture({ projectId: req.projectId, title: req.title, story: req.story, genre });
  return {
    status: "fixture",
    source: "fixture",
    provider: null,
    project,
    rawProject: project,
    report: validateProject(project),
    playtest: runPlaytest(project),
    quality: null,
    review: null,
    attempts: [],
    message: `${reason}已改用 demo fixture 建立可完整遊玩的專案。`,
  };
}

type Produced = { project: GameProject | null; raw: unknown; report: ValidationReport; playtest: PlaytestReport | null };

/** 呼叫 AI 產生資料，並以「驗證 + 自動試玩」把關，失敗時帶著程式實際產生的錯誤重試 */
async function produce(
  provider: StoryProvider,
  projectId: string,
  firstPrompt: string,
  firstKind: AttemptLog["kind"],
  maxRepairs: number,
  attempts: AttemptLog[],
  onProgress?: Progress,
): Promise<Produced> {
  const jsonSchema = aiProjectJsonSchema();
  let prompt = firstPrompt;
  let last: Produced = { project: null, raw: null, report: { isValid: false, errors: [], warnings: [] }, playtest: null };

  for (let i = 0; i <= maxRepairs; i++) {
    const kind = i === 0 ? firstKind : "repair";
    onProgress?.(kind === "generate" ? "AI 正在依故事生成遊戲資料…" : kind === "revise" ? "AI 正在依審查意見修改…" : `驗證未通過，進行第 ${i} 次修復…`);
    const output = await provider.generateJson({ systemPrompt: SYSTEM_PROMPT, prompt, jsonSchema });
    const normalized = normalizeAiProject(output, projectId);
    const result = validateProject(normalized.project);
    const playtest = result.project ? runPlaytest(result.project) : null;
    const errors = [...result.errors, ...(playtest?.issues ?? [])];
    const warnings = playtest?.truncated
      ? [...result.warnings, { path: "playtest", message: `狀態太多，自動試玩只探索了 ${playtest.statesExplored} 個狀態，結果不完整` }]
      : result.warnings;
    attempts.push({ attempt: attempts.length + 1, kind, errors, notes: normalized.notes });
    last = { project: errors.length === 0 ? (result.project ?? null) : null, raw: normalized.project, report: { isValid: errors.length === 0, errors, warnings }, playtest };
    if (last.project) return last;
    prompt = repairPrompt(output, errors);
  }
  return last;
}

export async function generateProject(
  provider: StoryProvider | null,
  req: GenerateRequest,
  onProgress?: Progress,
  options: { review?: boolean; from?: GameProject; treatment?: boolean } = {},
): Promise<GenerateResponse> {
  const story = checkStory(req.story);
  if (!provider) return fixtureResponse(req, "未設定 AI provider，");
  const status = await provider.available();
  if (!status.ok) return fixtureResponse(req, `${status.detail}。`);

  const attempts: AttemptLog[] = [];
  // 先寫劇本大綱：角色動機、章節轉折、支線與結局意義先想清楚，長度才是靠劇情撐起來
  let treatment: Treatment | null = null;
  if (options.treatment !== false) {
    onProgress?.("撰寫劇本大綱中…");
    try {
      treatment = await writeTreatment(provider, story, req);
    } catch (e) {
      onProgress?.(`劇本大綱失敗（${(e as Error).message}），改為直接依故事生成`);
    }
  }
  const outline = treatment ? treatmentText(treatment) : undefined;
  const base = { source: "ai" as const, provider: provider.name, attempts, treatment };
  // --from：從既有、已通過驗證的遊戲開始改進（保留內容，只依品質指標與審查意見修改）
  let best: Produced;
  if (options.from) {
    const fromProject = { ...options.from, id: req.projectId };
    const playtest = runPlaytest(fromProject);
    best = { project: fromProject, raw: fromProject, report: validateProject(fromProject), playtest };
    onProgress?.("從既有遊戲開始改進…");
  } else {
    best = await produce(provider, req.projectId, generationPrompt(story, req, outline), "generate", MAX_REPAIR_ATTEMPTS, attempts, onProgress);
  }
  if (!best.project) {
    return {
      ...base,
      status: "invalid",
      project: null,
      rawProject: best.raw,
      report: best.report,
      playtest: best.playtest,
      quality: null,
      review: null,
      message: `AI 生成的資料在 ${attempts.length} 次嘗試後仍未通過驗證或自動試玩。`,
    };
  }
  const done = (s: PipelineStatus, quality: QualityReport | null, review: ReviewResult | null, message: string): GenerateResponse => ({
    ...base,
    status: s,
    project: best.project,
    rawProject: best.raw,
    report: best.report,
    playtest: best.playtest,
    quality,
    review,
    message,
  });
  if (options.review === false) return done("unreviewed", assessQuality(best.project, best.playtest!), null, "通過驗證與自動試玩（未執行品質審查）。");

  for (let round = 0; ; round++) {
    const quality = assessQuality(best.project!, best.playtest!);
    let review: ReviewResult | null = null;
    let feedback: string[];
    if (quality.blocking.length > 0) {
      onProgress?.(`品質指標未達標（${quality.blocking.length} 項）`);
      feedback = quality.blocking.map((b) => `［品質指標］${b.message}`);
    } else {
      onProgress?.("獨立 AI 審查中…");
      try {
        review = await reviewProject(provider, story, best.project!, best.playtest!, quality);
      } catch (e) {
        return done("needs_human_review", quality, null, `AI 審查失敗（${(e as Error).message}），需要人工 review。`);
      }
      if (review.passed) return done("approved", quality, review, `通過驗證、自動試玩、品質指標與 AI 審查（總分 ${review.review.overall}/10），可以發布。`);
      onProgress?.(`AI 審查未通過：${review.reasons.join("、")}`);
      feedback = [
        ...review.reasons.map((r) => `［審查結論］${r}`),
        ...review.review.issues.map((i) => `［${i.severity}／${i.area}］${i.problem} → 建議：${i.suggestion}`),
      ];
    }
    if (round >= MAX_REVIEW_ROUNDS) {
      return done("needs_human_review", quality, review, `經過 ${MAX_REVIEW_ROUNDS} 輪修改仍未達品質標準，需要人工 review（遊戲本身可以正常遊玩）。`);
    }
    const candidate = await produce(provider, req.projectId, revisePrompt(story, best.raw, feedback, outline), "revise", 1, attempts, onProgress);
    if (!candidate.project) {
      return done("needs_human_review", quality, review, "依審查意見修改後的版本未通過驗證，保留上一個可遊玩版本，需要人工 review。");
    }
    best = candidate;
  }
}

export async function repairProject(
  provider: StoryProvider | null,
  project: unknown,
  errors: ValidationIssue[],
  projectId: string,
  onProgress?: Progress,
): Promise<GenerateResponse> {
  if (!provider) throw new ProviderError("未設定 AI provider，無法進行 AI 修復", "unavailable");
  const status = await provider.available();
  if (!status.ok) throw new ProviderError(status.detail, "unavailable");
  const attempts: AttemptLog[] = [];
  const result = await produce(provider, projectId, repairPrompt(project, errors), "repair", MAX_REPAIR_ATTEMPTS - 1, attempts, onProgress);
  return {
    status: result.project ? "unreviewed" : "invalid",
    source: "ai",
    provider: provider.name,
    project: result.project,
    rawProject: result.raw,
    report: result.report,
    playtest: result.playtest,
    quality: result.project ? assessQuality(result.project, result.playtest!) : null,
    review: null,
    attempts,
    message: result.project ? "AI 修復完成並通過驗證與自動試玩。" : "AI 修復後仍未通過驗證或自動試玩。",
  };
}

export function providerFromEnv(): StoryProvider | null {
  const name = (process.env.AI_PROVIDER ?? "claude-code").toLowerCase();
  if (name === "none") return null;
  if (name === "claude-code") return new ClaudeCodeProvider();
  throw new ProviderError(`不支援的 AI_PROVIDER：${name}`, "unavailable");
}
