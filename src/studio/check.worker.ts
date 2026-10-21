/// <reference lib="webworker" />
import type { GameProject } from "@/game/schema";
import { runCheck } from "./check";

/** 在背景執行緒跑完整檢查（驗證＋設計防呆＋自動試玩），頁面不會凍結 */
self.onmessage = (e: MessageEvent<{ id: number; project: GameProject; options: { demo?: boolean } }>) => {
  const { id, project, options } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, report: runCheck(project, options) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
