import { z } from "zod";
import demoFixture from "../../public/games/demo-lantern/project.json";
import { projectRevision, type PlayerState } from "./engine";
import type { GameProject } from "./schema";
import { validateProject } from "./validate";

/**
 * 瀏覽器端儲存（localStorage）。三種資料彼此分離（SPEC §9）：
 * - GameProject：設計內容（`rpg:project:<id>`，含最多 HISTORY_LIMIT 個舊版本供 undo）
 * - ProjectMetadata：專案列表資訊（同一筆紀錄內）
 * - PlayerSave：玩家進度（`rpg:save:<id>:<slot>`，slot = auto 或 1～3）
 * 進度只存在目前這個瀏覽器；跨裝置請用 JSON 匯出／匯入。
 */

export const DEMO_PROJECT_ID = "demo-lantern";
const PROJECT_PREFIX = "rpg:project:";
const SAVE_PREFIX = "rpg:save:";
const HISTORY_LIMIT = 15;

export type ProjectSource = "demo" | "ai" | "fixture" | "import" | "manual";
export type ProjectMetadata = {
  id: string;
  title: string;
  source: ProjectSource;
  story?: string;
  /** AI 流程的最終審查狀態（approved / needs_human_review / unreviewed / fixture） */
  pipelineStatus?: string;
  createdAt: string;
  updatedAt: string;
};
type StoredProject = { metadata: ProjectMetadata; project: GameProject; history: GameProject[] };

export function getDemoProject(): GameProject {
  const result = validateProject(demoFixture);
  if (!result.project) throw new Error(`Demo fixture 驗證失敗：${result.errors.map((e) => `${e.path} ${e.message}`).join("; ")}`);
  return result.project;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  const raw = storage()?.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  const s = storage();
  if (!s) throw new Error("此瀏覽器無法使用 localStorage，無法儲存");
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("瀏覽器儲存空間不足，請先匯出或刪除部分專案");
  }
}

function readStored(id: string): StoredProject | null {
  const data = readJson(PROJECT_PREFIX + id) as StoredProject | null;
  if (!data?.metadata || !data.project) return null;
  const result = validateProject(data.project);
  if (!result.project) return null;
  return { metadata: data.metadata, project: result.project, history: Array.isArray(data.history) ? data.history : [] };
}

export function listProjects(): ProjectMetadata[] {
  const s = storage();
  if (!s) return [];
  const list: ProjectMetadata[] = [];
  for (let i = 0; i < s.length; i++) {
    const key = s.key(i);
    if (!key?.startsWith(PROJECT_PREFIX)) continue;
    const data = readJson(key) as StoredProject | null;
    if (data?.metadata) list.push(data.metadata);
  }
  return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 讀取專案；demo 專案若尚未被編輯過，直接使用內建 fixture */
export function loadProject(id: string): { project: GameProject; metadata: ProjectMetadata; history: GameProject[] } | null {
  const stored = readStored(id);
  if (stored) return stored;
  if (id === DEMO_PROJECT_ID) {
    const project = getDemoProject();
    const now = new Date(0).toISOString();
    return { project, metadata: { id, title: project.title, source: "demo", createdAt: now, updatedAt: now }, history: [] };
  }
  return null;
}

/** 儲存專案（會先驗證）。上一版會推入歷史紀錄，供 undo。 */
export function saveProject(project: GameProject, meta: Partial<ProjectMetadata> = {}) {
  const result = validateProject(project);
  if (!result.project) throw new Error(`專案驗證失敗，未儲存：${result.errors[0]?.message ?? ""}`);
  const existing = loadProject(project.id);
  const now = new Date().toISOString();
  const history = existing ? [existing.project, ...existing.history].slice(0, HISTORY_LIMIT) : [];
  const metadata: ProjectMetadata = {
    id: project.id,
    title: project.title,
    source: meta.source ?? existing?.metadata.source ?? "manual",
    story: meta.story ?? existing?.metadata.story,
    // 手動修改後就不再是 AI 審查過的版本
    pipelineStatus: meta.pipelineStatus ?? (meta.source ? undefined : existing?.metadata.pipelineStatus && "edited"),
    createdAt: existing?.metadata.createdAt && existing.metadata.createdAt !== new Date(0).toISOString() ? existing.metadata.createdAt : now,
    updatedAt: now,
  };
  writeJson(PROJECT_PREFIX + project.id, { metadata, project: result.project, history } satisfies StoredProject);
  return metadata;
}

/** 復原到上一個版本 */
export function undoProject(id: string): GameProject | null {
  const stored = readStored(id);
  if (!stored || stored.history.length === 0) return null;
  const [previous, ...rest] = stored.history;
  const result = validateProject(previous);
  if (!result.project) return null;
  writeJson(PROJECT_PREFIX + id, {
    metadata: { ...stored.metadata, title: result.project.title, updatedAt: new Date().toISOString() },
    project: result.project,
    history: rest,
  } satisfies StoredProject);
  return result.project;
}

export function deleteProject(id: string) {
  storage()?.removeItem(PROJECT_PREFIX + id);
  for (const slot of SAVE_SLOTS) storage()?.removeItem(saveKey(id, slot));
}

export function newProjectId(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return `${slug || "rpg"}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- 玩家存檔 ----------

const flagValue = z.union([z.string(), z.number(), z.boolean()]);
const playerStateSchema = z.object({
  schemaVersion: z.literal("1.0"),
  projectId: z.string(),
  projectRevision: z.string(),
  sceneId: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  facing: z.enum(["up", "down", "left", "right"]),
  stats: z.object({ hp: z.number(), level: z.number(), xp: z.number() }),
  inventory: z.record(z.string(), z.number().int().min(0)),
  flags: z.record(z.string(), flagValue),
  quests: z.record(
    z.string(),
    z.object({ status: z.enum(["inactive", "active", "completed"]), objectiveIndex: z.number().int(), count: z.number().int() }),
  ),
  collectedPickups: z.array(z.string()),
  choicesMade: z.array(z.string()),
  dialogue: z.object({ npcId: z.string(), nodeId: z.string() }).nullable(),
  endingId: z.string().nullable(),
  log: z.array(z.string()),
  steps: z.number().int(),
});

export type SaveSlot = "auto" | "1" | "2" | "3";
export const SAVE_SLOTS: SaveSlot[] = ["auto", "1", "2", "3"];
export type SaveFile = { savedAt: string; state: PlayerState };
export type LoadSaveResult = { save: SaveFile | null; notice?: string };

const saveKey = (projectId: string, slot: SaveSlot) => `${SAVE_PREFIX}${projectId}:${slot}`;

export function savePlayerState(state: PlayerState, slot: SaveSlot = "auto"): string {
  const savedAt = new Date().toISOString();
  writeJson(saveKey(state.projectId, slot), { savedAt, state } satisfies SaveFile);
  return savedAt;
}

export function loadPlayerState(project: GameProject, slot: SaveSlot = "auto"): LoadSaveResult {
  const data = readJson(saveKey(project.id, slot)) as { savedAt?: unknown; state?: unknown } | null;
  if (!data) return { save: null };
  const parsed = playerStateSchema.safeParse(data.state);
  if (!parsed.success) return { save: null, notice: "存檔格式損毀，無法讀取" };
  if (parsed.data.projectId !== project.id) return { save: null, notice: "存檔不屬於此專案" };
  if (parsed.data.projectRevision !== projectRevision(project)) {
    return { save: null, notice: "專案內容已修改，這份舊存檔無法沿用" };
  }
  return { save: { savedAt: String(data.savedAt ?? ""), state: parsed.data } };
}

/** 列出所有存檔欄位（含無法沿用的原因），供標題畫面與選單使用 */
export function listSaves(project: GameProject): Array<{ slot: SaveSlot } & LoadSaveResult> {
  return SAVE_SLOTS.map((slot) => ({ slot, ...loadPlayerState(project, slot) }));
}

export function clearPlayerState(projectId: string, slot: SaveSlot = "auto") {
  storage()?.removeItem(saveKey(projectId, slot));
}

// ---------- 匯出／匯入 ----------

export function exportProjectJson(project: GameProject): string {
  return JSON.stringify(project, null, 2);
}

export function downloadJson(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseProjectJson(text: string) {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return validateProjectError(`不是有效的 JSON：${(e as Error).message}`);
  }
  return validateProject(data);
}

function validateProjectError(message: string) {
  return { isValid: false, errors: [{ path: "", message }], warnings: [], project: undefined };
}
