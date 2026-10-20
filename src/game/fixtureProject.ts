import demoFixture from "@/fixtures/demo-project.json";
import type { GameProject } from "./schema";
import { validateProject } from "./validate";

export type FixtureRequest = { projectId: string; title?: string; story?: string; genre?: GameProject["genre"] };

/**
 * 沒有可用 AI 時的明確退回方案：以 demo fixture 為範本建立新專案。
 * 只替換專案 ID、名稱、簡介與類型，遊戲內容仍是 demo，介面上會標示來源為 fixture。
 */
export function projectFromFixture(req: FixtureRequest): GameProject {
  const base = structuredClone(demoFixture) as unknown as GameProject;
  const story = req.story?.trim();
  const project: GameProject = {
    ...base,
    id: req.projectId,
    title: req.title?.trim().slice(0, 200) || base.title,
    description: story ? `（以 demo 範本建立，尚未由 AI 依故事生成）${story.slice(0, 300)}` : base.description,
    genre: req.genre ?? base.genre,
  };
  const result = validateProject(project);
  if (!result.project) throw new Error("demo fixture 範本驗證失敗");
  return result.project;
}
