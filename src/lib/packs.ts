import type { CoverData } from "@/game/cover";
import type { GameProject } from "@/game/schema";
import { validateProject, type ValidationIssue } from "@/game/validate";

/**
 * 遊戲模組包：每款遊戲是 /games/<id>/project.json（靜態檔案，可放在 Cloudflare）。
 * /games/index.json 是由 scripts/build-catalog.ts 驗證後自動產生的目錄。
 * 之後若改成使用者發布，只要把這兩個網址換成 API（例如 Cloudflare R2 + Worker），格式不變。
 */

export type CatalogEntry = {
  id: string;
  title: string;
  description: string;
  genre: GameProject["genre"];
  status: "demo" | "approved";
  endings: number;
  /** 成就數（作者寫的成就＋真正的結局） */
  achievements?: number;
  npcs: number;
  /** 章節數（舊目錄沒有這個欄位） */
  chapters?: number;
  /** 連載中或已完結（舊目錄沒有這個欄位＝已完結） */
  release?: "ongoing" | "complete";
  plannedChapters?: number;
  typicalMinutes: [number, number] | null;
  cover: CoverData;
  path: string;
  revision: string;
};
export type Catalog = { generatedAt: string; games: CatalogEntry[] };

export const CATALOG_URL = "/games/index.json";

export async function fetchCatalog(): Promise<Catalog> {
  const res = await fetch(CATALOG_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error(`無法載入遊戲目錄（HTTP ${res.status}）`);
  return res.json();
}

export class PackError extends Error {
  constructor(
    message: string,
    readonly issues: ValidationIssue[] = [],
  ) {
    super(message);
  }
}

/** 下載並驗證一款遊戲；驗證失敗的資料不會進入遊戲。同時回傳目錄中的資訊（例如預估時長） */
export async function fetchPack(id: string): Promise<{ project: GameProject; bytes: number; entry: CatalogEntry | null }> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new PackError(`遊戲 ID「${id}」格式不正確`);
  const [res, catalog] = await Promise.all([fetch(`/games/${id}/project.json`, { cache: "no-cache" }), fetchCatalog().catch(() => null)]);
  if (!res.ok) throw new PackError(`找不到遊戲「${id}」（HTTP ${res.status}）`);
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PackError(`遊戲「${id}」的資料不是有效的 JSON`);
  }
  const result = validateProject(data);
  if (!result.project) throw new PackError(`遊戲「${id}」的資料未通過驗證`, result.errors);
  return { project: result.project, bytes: new Blob([text]).size, entry: catalog?.games.find((g) => g.id === id) ?? null };
}
