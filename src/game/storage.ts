import { z } from "zod";
import { reconcileState, type PlayerState } from "./engine";
import type { GameProject } from "./schema";

/**
 * 玩家存檔（瀏覽器 localStorage：`rpg:save:<專案ID>:<欄位>`，欄位 = auto 或 1～3）。
 * 進度只存在目前這個瀏覽器。遊戲更新後舊存檔仍可讀取（會自動對齊到新版內容，見 engine.reconcileState）。
 */

const SAVE_PREFIX = "rpg:save:";

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
  if (!s) throw new Error("此瀏覽器無法使用 localStorage，無法存檔");
  try {
    s.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error("瀏覽器儲存空間不足，無法存檔");
  }
}

const playerStateSchema = z.looseObject({
  schemaVersion: z.literal("2.0"),
  projectId: z.string(),
  projectRevision: z.string(),
  mapId: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  switches: z.record(z.string(), z.boolean()),
  variables: z.record(z.string(), z.number()),
  selfSwitches: z.record(z.string(), z.boolean()),
  items: z.record(z.string(), z.number().int().min(0)),
  quests: z.record(z.string(), z.object({ status: z.string(), step: z.number().int() })),
});

export type SaveSlot = "auto" | "1" | "2" | "3";
export const SAVE_SLOTS: SaveSlot[] = ["auto", "1", "2", "3"];
export type SaveFile = { savedAt: string; state: PlayerState };
export type LoadSaveResult = { save: SaveFile | null; notice?: string };

const saveKey = (projectId: string, slot: SaveSlot | Checkpoint) => `${SAVE_PREFIX}${projectId}:${slot}`;

/**
 * 自動存檔點（不佔玩家的存檔欄位）：讓玩家回頭走另一條分支。
 * - `ch_<章節ID>`：每一章開頭（章節標題卡出現時）的狀態，標題畫面的「章節選擇」用
 * - `choice`：最近一次出現選項時的狀態，結局畫面的「回到最後的抉擇」用
 */
export type Checkpoint = "choice" | `ch_${string}`;

export function saveCheckpoint(state: PlayerState, key: Checkpoint) {
  try {
    writeJson(saveKey(state.projectId, key), { savedAt: new Date().toISOString(), state } satisfies SaveFile);
  } catch {
    // 存不了存檔點不影響遊玩
  }
}

export function loadCheckpoint(project: GameProject, key: Checkpoint): SaveFile | null {
  const data = readJson(saveKey(project.id, key)) as { savedAt?: unknown; state?: unknown } | null;
  const parsed = data ? playerStateSchema.safeParse(data.state) : null;
  if (!parsed?.success || parsed.data.projectId !== project.id) return null;
  return { savedAt: String(data!.savedAt ?? ""), state: reconcileState(project, parsed.data as unknown as PlayerState) };
}

/** 每一章的開頭存檔點（沒玩到的章節是 null） */
export function listChapterCheckpoints(project: GameProject) {
  return project.chapters.map((chapter) => ({ chapter, save: loadCheckpoint(project, `ch_${chapter.id}`) }));
}

export function savePlayerState(state: PlayerState, slot: SaveSlot = "auto"): string {
  const savedAt = new Date().toISOString();
  writeJson(saveKey(state.projectId, slot), { savedAt, state } satisfies SaveFile);
  return savedAt;
}

export function loadPlayerState(project: GameProject, slot: SaveSlot = "auto"): LoadSaveResult {
  const data = readJson(saveKey(project.id, slot)) as { savedAt?: unknown; state?: unknown } | null;
  if (!data) return { save: null };
  const parsed = playerStateSchema.safeParse(data.state);
  if (!parsed.success) return { save: null, notice: "舊版格式的存檔，無法讀取" };
  if (parsed.data.projectId !== project.id) return { save: null, notice: "存檔不屬於此遊戲" };
  return { save: { savedAt: String(data.savedAt ?? ""), state: reconcileState(project, parsed.data as unknown as PlayerState) } };
}

/** 列出所有存檔欄位（含無法讀取的原因），供標題畫面與選單使用 */
export function listSaves(project: GameProject): Array<{ slot: SaveSlot } & LoadSaveResult> {
  return SAVE_SLOTS.map((slot) => ({ slot, ...loadPlayerState(project, slot) }));
}

export function clearPlayerState(projectId: string, slot: SaveSlot = "auto") {
  storage()?.removeItem(saveKey(projectId, slot));
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
