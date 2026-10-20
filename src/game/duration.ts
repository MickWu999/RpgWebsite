import { createInitialState, currentDialogueNode } from "./engine";
import { applyAction, type PlaytestReport } from "./playtest";
import type { GameProject } from "./schema";

/**
 * 預估遊玩時長：沿自動試玩找到的最短通關路線，累計移動步數、閱讀字數與選擇次數。
 * 一般玩家會探索、閒聊、想選項，實際時長約為最短路線的 2.5～3 倍（經驗估計，非實測）。
 */

const SECONDS_PER_STEP = 0.14;
const CHARS_PER_SECOND = 7;
const SECONDS_PER_CHOICE = 3;
const SECONDS_PER_ACTION = 1.5;
export const PLAYER_FACTOR: [number, number] = [2.5, 3];

export type DurationEstimate = { shortestMinutes: number; typicalMinutes: [number, number] };

export function estimateDuration(project: GameProject, playtest: PlaytestReport): DurationEstimate | null {
  const routes = playtest.endings.filter((e) => e.reachable && e.actions);
  if (routes.length === 0) return null;
  const intro = [...(project.intro ?? project.description)].length;
  const seconds = routes.map((e) => {
    let state = createInitialState(project);
    let steps = 0;
    let chars = intro;
    let choices = 0;
    for (const action of e.actions!) {
      if ("moves" in action) steps += action.moves.length;
      if (action.kind === "choose") choices++;
      state = applyAction(project, state, action);
      const node = currentDialogueNode(project, state);
      if (node) chars += [...node.text].length;
    }
    chars += [...(project.endings.find((x) => x.id === e.endingId)?.text ?? "")].length;
    return steps * SECONDS_PER_STEP + chars / CHARS_PER_SECOND + choices * SECONDS_PER_CHOICE + e.actions!.length * SECONDS_PER_ACTION;
  });
  const shortest = Math.min(...seconds) / 60;
  return {
    shortestMinutes: Math.round(shortest * 10) / 10,
    typicalMinutes: [Math.max(1, Math.round(shortest * PLAYER_FACTOR[0])), Math.max(1, Math.round(shortest * PLAYER_FACTOR[1]))],
  };
}
