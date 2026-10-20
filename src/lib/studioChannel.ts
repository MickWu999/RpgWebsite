import type { GameProject } from "@/game/schema";

/**
 * 後台編輯器 → 測試遊玩視窗的即時同步（同一個瀏覽器、不同分頁，用 BroadcastChannel）。
 * 編輯器每次修改都廣播目前的專案；測試視窗收到後保留玩家進度、直接套用新內容，不用重玩。
 */
export const STUDIO_CHANNEL = "rpg-studio";

export type StudioBroadcast = { type: "project"; projectId: string; project: GameProject };

let channel: BroadcastChannel | null = null;

/** projectId 是雲端專案 ID（匯入的專案內部 ID 可能不同） */
export function broadcastProject(projectId: string, project: GameProject) {
  if (typeof BroadcastChannel === "undefined") return;
  channel ??= new BroadcastChannel(STUDIO_CHANNEL);
  channel.postMessage({ type: "project", projectId, project } satisfies StudioBroadcast);
}
