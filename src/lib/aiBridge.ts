import type { GameProject } from "@/game/schema";
import type { ValidationIssue, ValidationReport } from "@/game/validate";

/**
 * 瀏覽器端呼叫本機 AI bridge（npm run ai）。部署到雲端時偵測不到 bridge，介面會明確標示「AI 生成僅限本機」。
 */

export const AI_BRIDGE_URL = process.env.NEXT_PUBLIC_AI_BRIDGE_URL ?? "http://127.0.0.1:8787";

export type BridgeStatus = { reachable: boolean; available: boolean; detail: string };

export type PipelineStatus = "approved" | "needs_human_review" | "invalid" | "unreviewed" | "fixture";

export type BridgeGenerateResult = {
  status: PipelineStatus;
  source: "ai" | "fixture";
  provider: string | null;
  project: GameProject | null;
  rawProject: unknown;
  report: ValidationReport;
  review: { passed: boolean; reasons: string[]; review: { overall: number; summary: string } } | null;
  attempts: Array<{ attempt: number; kind: string; errors: ValidationIssue[]; notes: string[] }>;
  message: string;
};

export async function checkBridge(): Promise<BridgeStatus> {
  try {
    const res = await fetch(`${AI_BRIDGE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    const data = await res.json();
    return { reachable: true, available: Boolean(data.available), detail: String(data.detail ?? "") };
  } catch {
    return { reachable: false, available: false, detail: "未偵測到本機 AI bridge（請在本機執行 npm run ai）" };
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${AI_BRIDGE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15 * 60_000),
    });
  } catch (e) {
    throw new Error(`無法連線到本機 AI bridge：${(e as Error).message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `AI bridge 回應錯誤（HTTP ${res.status}）`);
  return data as T;
}

export function bridgeGenerate(body: { story: string; title?: string; genre?: string; style?: string; projectId: string }) {
  return post<BridgeGenerateResult>("/api/projects/generate", body);
}

export function bridgeRepair(body: { project: unknown; errors: ValidationIssue[]; projectId: string }) {
  return post<BridgeGenerateResult>("/api/projects/repair", body);
}
