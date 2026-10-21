import { evaluateCondition, type PlayerState } from "./engine";
import type { GameProject } from "./schema";

/**
 * 成就：讓玩家知道「還有別的分支、別的發現」。
 * - 作者寫的成就（project.achievements）：條件成立時解鎖
 * - 結局成就：每個真正的結局自動產生一個（連載的「未完待續」不算）
 * 解鎖紀錄跨存檔保存在玩家的裝置上（localStorage），重玩不同路線會一直累積。
 */

export type AchievementView = {
  id: string;
  title: string;
  description: string;
  hint?: string;
  hidden?: boolean;
  kind: "authored" | "ending";
};

export function achievementList(project: GameProject): AchievementView[] {
  const authored = (project.achievements ?? []).map((a) => ({ id: a.id, title: a.title, description: a.description, hint: a.hint, hidden: a.hidden, kind: "authored" as const }));
  const endings = project.endings
    .filter((e) => !e.nextChapterId)
    .map((e) => ({ id: `ending:${e.id}`, title: `結局：${e.title}`, description: "看到了這個結局。", hint: "還有一個結局在等你", kind: "ending" as const }));
  return [...authored, ...endings];
}

/** 這個狀態下新解鎖的成就 */
export function newlyUnlocked(project: GameProject, state: PlayerState, unlocked: Record<string, string>): AchievementView[] {
  const list = achievementList(project);
  const out: AchievementView[] = [];
  for (const a of list) {
    if (unlocked[a.id]) continue;
    if (a.kind === "ending") {
      if (state.endingId && a.id === `ending:${state.endingId}`) out.push(a);
      continue;
    }
    const def = project.achievements!.find((x) => x.id === a.id)!;
    try {
      if (evaluateCondition(state, def.condition, null)) out.push(a);
    } catch {
      // 條件寫錯（例如引用了不存在的開關）時當作沒解鎖，不影響遊玩
    }
  }
  return out;
}

const key = (gameId: string) => `rpg:achv:${gameId}`;

export function loadUnlocked(gameId: string): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(key(gameId)) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveUnlocked(gameId: string, unlocked: Record<string, string>) {
  try {
    window.localStorage.setItem(key(gameId), JSON.stringify(unlocked));
  } catch {
    // 記不住也不影響遊玩
  }
}
