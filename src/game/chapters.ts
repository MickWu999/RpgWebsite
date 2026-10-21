import { estimateDuration } from "./duration";
import { createChapterState, type PlayerState } from "./engine";
import { endingGoals, runPlaytest, type PlaytestGoal, type PlaytestReport } from "./playtest";
import type { GameProject } from "./schema";
import type { ValidationIssue } from "./validate";

/**
 * 章節檢查：長篇遊戲以章為單位製作與把關。
 * 每章從自己的「測試起點」自動試玩，目標是進入下一章（「章節」指令，或指向下一章的「未完待續」結局）；最後一章的目標是任一結局。
 * 這樣不必每次從頭窮舉整款遊戲（1～2 小時的遊戲狀態太多），也能分別算出每章的時長、找出每章的卡死狀態。
 */

export type ChapterReport = {
  id: string;
  title: string;
  index: number;
  ok: boolean;
  /** 從測試起點走到下一章（或結局）的最短路線 */
  route: string[] | null;
  minutes: [number, number] | null;
  statesExplored: number;
  truncated: boolean;
  issues: ValidationIssue[];
};

export function chapterGoal(project: GameProject, index: number): PlaytestGoal {
  const next = project.chapters[index + 1];
  // 連載的章末是「未完待續」結局（ending.nextChapterId）：抵達指向下一章的結局，也算進入下一章
  const bridges = new Set(next ? project.endings.filter((e) => e.nextChapterId === next.id).map((e) => e.id) : []);
  if (next) return { id: `chapter:${next.id}`, title: `進入「${next.title}」`, reached: (s) => s.chapterId === next.id || (s.endingId !== null && bridges.has(s.endingId)) };
  return { id: "ending", title: "抵達任一結局", reached: (s) => s.endingId !== null };
}

export function chapterPlaytest(project: GameProject, index: number, maxStates = 20000): { start: PlayerState | null; playtest: PlaytestReport | null; error?: string } {
  const chapter = project.chapters[index];
  if (!chapter.testStart) return { start: null, playtest: null, error: `章節「${chapter.title}」沒有設定測試起點` };
  let start: PlayerState;
  try {
    start = createChapterState(project, chapter.id);
  } catch (e) {
    return { start: null, playtest: null, error: `從章節起點開始時發生錯誤：${(e as Error).message}` };
  }
  return { start, playtest: runPlaytest(project, { start, goals: [chapterGoal(project, index)], maxStates }) };
}

export function checkChapters(project: GameProject): ChapterReport[] {
  return project.chapters.map((chapter, index) => {
    const { start, playtest, error } = chapterPlaytest(project, index);
    if (!playtest || !start) {
      return { id: chapter.id, title: chapter.title, index, ok: false, route: null, minutes: null, statesExplored: 0, truncated: false, issues: [{ path: `chapters.${chapter.id}`, message: error ?? "無法試玩" }] };
    }
    const goal = playtest.goals[0];
    const issues = playtest.issues.map((i) => ({ path: `chapters.${chapter.id}`, message: `第 ${index + 1} 章：${i.message}` }));
    return {
      id: chapter.id,
      title: chapter.title,
      index,
      ok: playtest.ok,
      route: goal.reachable ? (goal.steps ?? []) : null,
      minutes: estimateDuration(project, playtest, start)?.typicalMinutes ?? null,
      statesExplored: playtest.statesExplored,
      truncated: playtest.truncated,
      issues,
    };
  });
}

/**
 * 整款遊戲的自動試玩（分章節的遊戲）：先從頭窮舉；分章節的遊戲狀態太多，後面章節的結局常常在額度內走不到，
 * 這時改從各章的測試起點找還沒找到的結局。各章能接到下一章由 checkChapters 把關，兩者合起來仍保證每個結局都玩得到。
 */
export function fullPlaytest(project: GameProject): PlaytestReport {
  const whole = runPlaytest(project);
  if (project.chapters.length < 2 || whole.goals.every((g) => g.reachable)) return whole;
  const found = new Map<string, PlaytestReport["goals"][number]>();
  for (const chapter of project.chapters.slice(1)) {
    const goals = endingGoals(project).filter((g) => !found.has(g.id) && whole.goals.some((w) => w.id === g.id && !w.reachable));
    if (!goals.length) break;
    if (!chapter.testStart) continue;
    let start: PlayerState;
    try {
      start = createChapterState(project, chapter.id);
    } catch {
      continue;
    }
    const r = runPlaytest(project, { start, goals, maxStates: 20000 });
    r.goals.filter((g) => g.reachable).forEach((g) => found.set(g.id, { ...g, fromChapter: chapter.id, steps: [`從「${chapter.title}」的測試起點開始`, ...(g.steps ?? [])] }));
  }
  const goals = whole.goals.map((g) => (g.reachable ? g : (found.get(g.id) ?? g)));
  const issues = whole.issues.filter((i) => !(i.path.startsWith("goals.") && found.has(i.path.slice(6))));
  return { ...whole, goals, issues, ok: issues.length === 0 };
}
