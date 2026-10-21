import type { GameProject } from "@/game/schema";
import { publishSummary, type CheckReport } from "@/studio/check";

/** Studio 後台 API 用戶端（同網域，登入 cookie 自動帶上）。401 時導向登入頁。 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/api/auth/login")) {
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/studio/login")) {
      window.location.href = `/studio/login/?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    }
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`, data);
  return data as T;
}

export type ProjectSummary = {
  id: string;
  title: string;
  version: number;
  is_valid: number;
  updated_at: string;
  created_at: string;
  archived_at: string | null;
  published_version: number | null;
  published_at: string | null;
  /** AI 製作進度 */
  has_story: number;
  has_treatment: number;
  treatment_passed: number | null;
  full_passed: number | null;
  chapters_total: number | null;
  chapters_passed: number;
  last_actor: string | null;
};
export type PlayAnalytics = {
  visitors: number;
  sessions: number;
  minutes: number | null;
  chapters: Array<{ chapter_id: string; entered: number; done: number; minutes: number | null }>;
  endings: Array<{ ref: string; players: number }>;
  quits: Array<{ chapter_id: string | null; ref: string | null; players: number }>;
  daily: Array<{ day: string; visitors: number }>;
};
export type NoteEntry = {
  id: string;
  locator: string | null;
  map_id: string | null;
  x: number | null;
  y: number | null;
  chapter_id: string | null;
  excerpt: string | null;
  state: { switches: string[]; variables: Record<string, number>; items: Record<string, number>; quests: Record<string, string> } | null;
  body: string;
  author: string;
  status: "open" | "resolved" | "wontfix";
  resolution: string | null;
  resolved_by: string | null;
  created_at: string;
  resolved_at: string | null;
};
export type FeedbackEntry = { chapter_id: string; rating: number; tags: string[]; comment: string; created_at: string };
export type ProjectDoc = { kind: "story" | "treatment"; content: string; updated_at: string; updated_by: string };
export type ReviewEntry = {
  id: string;
  kind: "treatment" | "chapter" | "full";
  target: string;
  revision: string | null;
  passed: boolean;
  overall: number | null;
  actor: string;
  created_at: string;
  data: {
    summary?: string;
    reasons?: string[];
    review: {
      overall: number;
      summary: string;
      scores: Record<string, number>;
      issues: Array<{ severity: string; area: string; problem: string; suggestion: string }>;
      followUp?: Array<{ problem: string; resolved: boolean; note: string }>;
      players?: Array<{ persona: "veteran" | "casual" | "story"; wouldContinue: boolean; reason: string }>;
    };
    prediction?: { guesses: Array<{ about: string; guess: string }>; feelsLike: string[] } | null;
  };
};
export type VersionEntry = { version: number; label: string; actor: string; created_at: string };
export type TokenEntry = { id: string; name: string; token_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };
export type { CheckReport as CheckResult } from "@/studio/check";

export const studioApi = {
  me: () => call<{ user: { id: string; username: string }; operator: string | null }>("GET", "/api/auth/me"),
  login: (username: string, password: string, remember = true, operator = "") => call<{ user: { username: string } }>("POST", "/api/auth/login", { username, password, remember, operator }),
  setOperator: (name: string) => call<{ operator: string | null }>("POST", "/api/auth/operator", { name }),
  logout: () => call("POST", "/api/auth/logout", {}),
  changePassword: (current: string, next: string) => call<{ notice: string }>("POST", "/api/auth/password", { current, next }),
  listProjects: (archived = false) => call<{ projects: ProjectSummary[] }>("GET", `/api/projects${archived ? "?archived=1" : ""}`),
  createProject: (title: string, template: "blank" | "demo", extra: { story?: string; genre?: string } = {}) => call<{ id: string }>("POST", "/api/projects", { title, template, ...extra }),
  docs: (id: string) => call<{ docs: Partial<Record<"story" | "treatment", ProjectDoc>> }>("GET", `/api/projects/${id}/docs`),
  saveDoc: (id: string, kind: "story" | "treatment", content: string) => call("PUT", `/api/projects/${id}/docs/${kind}`, { content }),
  reviews: (id: string) => call<{ reviews: ReviewEntry[] }>("GET", `/api/projects/${id}/reviews`),
  feedback: (id: string) => call<{ feedback: FeedbackEntry[] }>("GET", `/api/projects/${id}/feedback`),
  notes: (id: string) => call<{ notes: NoteEntry[] }>("GET", `/api/projects/${id}/notes`),
  addNote: (id: string, note: { body: string; locator: string | null; mapId: string; x: number; y: number; chapterId: string | null; excerpt: string; state: unknown }) =>
    call<{ id: string }>("POST", `/api/projects/${id}/notes`, note),
  updateNote: (id: string, noteId: string, status: NoteEntry["status"], resolution = "") => call<{ ok: true }>("PATCH", `/api/projects/${id}/notes/${noteId}`, { status, resolution }),
  analytics: (id: string) => call<{ analytics: PlayAnalytics }>("GET", `/api/projects/${id}/analytics`),
  importProject: (project: unknown, title?: string) => call<{ id: string }>("POST", "/api/projects", { project, title }),
  getProject: (id: string) => call<{ id: string; version: number; project: GameProject; updatedAt: string }>("GET", `/api/projects/${id}`),
  saveProject: (id: string, project: GameProject, baseVersion: number | undefined, label: string, isValid: boolean) =>
    call<{ version: number }>("PUT", `/api/projects/${id}`, { project, baseVersion, label, isValid }),
  /** 典藏（軟刪除），可用 unarchiveProject 還原 */
  archiveProject: (id: string) => call("POST", `/api/projects/${id}/archive`, {}),
  unarchiveProject: (id: string) => call("POST", `/api/projects/${id}/unarchive`, {}),
  duplicateProject: (id: string, title?: string) => call<{ id: string }>("POST", `/api/projects/${id}/duplicate`, { title }),
  versions: (id: string) => call<{ versions: VersionEntry[] }>("GET", `/api/projects/${id}/versions`),
  restore: (id: string, version: number) => call<{ version: number }>("POST", `/api/projects/${id}/restore`, { version }),
  /** 發布：附上在瀏覽器執行的檢查摘要（伺服器只比對內容指紋） */
  publish: (id: string, check: CheckReport, allowQualityWarnings = false) => call<{ version: number }>("POST", `/api/projects/${id}/publish`, { allowQualityWarnings, check: publishSummary(check) }),
  unpublish: (id: string) => call("DELETE", `/api/projects/${id}/publish`),
  listTokens: () => call<{ tokens: TokenEntry[] }>("GET", "/api/tokens"),
  createToken: (name: string) => call<{ id: string; token: string }>("POST", "/api/tokens", { name }),
  revokeToken: (id: string) => call("DELETE", `/api/tokens/${id}`),
};

/** 前台網址（只顯示成文字，不做成連結；前後台互相獨立） */
/** 玩家網站網址：build 時從 .env.local 的 NEXT_PUBLIC_PLAYER_URL 讀取（實際網址不寫進 repo） */
export const PLAYER_SITE_URL = process.env.NEXT_PUBLIC_PLAYER_URL ?? "";
