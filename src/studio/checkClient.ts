import { projectRevision } from "@/game/engine";
import type { GameProject } from "@/game/schema";
import { runCheck, type CheckReport } from "./check";

/**
 * 瀏覽器裡的專案檢查：在背景執行緒（Web Worker）執行，大型遊戲的自動試玩要好幾秒，放在主執行緒會讓整個頁面凍結。
 * 結果依內容指紋快取：內容沒改過就直接用上次的結果（同一個分頁內，換頁再回來也不必重算）。
 * 瀏覽器不支援 Web Worker 時，退回在主執行緒執行。
 */

const memo = new Map<string, CheckReport>();
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (r: CheckReport) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker || typeof Worker === "undefined") return worker;
  try {
    worker = new Worker(new URL("./check.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; report?: CheckReport; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.report) p.resolve(e.data.report);
      else p.reject(new Error(e.data.error ?? "檢查失敗"));
    };
    worker.onerror = () => {
      // 背景執行緒無法啟動：之後改在主執行緒執行
      worker = null;
      for (const [, p] of pending) p.reject(new Error("worker"));
      pending.clear();
    };
  } catch {
    worker = null;
  }
  return worker;
}

const cacheKey = (project: GameProject, options: { demo?: boolean }) => `rpg:check:${projectRevision(project)}:${options.demo ? 1 : 0}`;

export async function runCheckAsync(project: GameProject, options: { demo?: boolean } = {}): Promise<CheckReport> {
  const key = cacheKey(project, options);
  const hit = memo.get(key) ?? readSession(key);
  if (hit) return hit;
  const w = getWorker();
  const report = w
    ? await new Promise<CheckReport>((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        w.postMessage({ id, project, options });
      }).catch(() => fallback(project, options))
    : await fallback(project, options);
  memo.set(key, report);
  writeSession(key, report);
  return report;
}

/** 退回主執行緒：先讓畫面更新（顯示「檢查中」），再運算 */
const fallback = (project: GameProject, options: { demo?: boolean }) => new Promise<CheckReport>((resolve) => setTimeout(() => resolve(runCheck(project, options)), 30));

function readSession(key: string): CheckReport | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as CheckReport) : null;
  } catch {
    return null;
  }
}
function writeSession(key: string, report: CheckReport) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(report));
  } catch {
    // 太大或無法儲存時只用記憶體快取
  }
}
