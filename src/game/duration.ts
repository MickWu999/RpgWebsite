import { createInitialState, type PlayerState } from "./engine";
import { applyAction, settle, type PlaytestReport } from "./playtest";
import type { GameProject } from "./schema";

/**
 * 預估遊玩時長：沿自動試玩找到的最短路線，累計移動步數、閱讀字數與選擇次數。
 * 一般玩家會探索、閒聊、想選項，實際時長約為最短路線的 2.5～3 倍（經驗估計，非實測）。
 */

const SECONDS_PER_STEP = 0.14;
const CHARS_PER_SECOND = 7;
const SECONDS_PER_CHOICE = 3;
const SECONDS_PER_ACTION = 1.5;
export const PLAYER_FACTOR: [number, number] = [2.5, 3];

export type DurationEstimate = { shortestMinutes: number; typicalMinutes: [number, number] };

export function routeSeconds(project: GameProject, playtest: PlaytestReport, start?: PlayerState): number[] {
  return playtest.goals
    .filter((g) => g.reachable && g.actions)
    .map((g) => {
      let steps = 0;
      let chars = start ? 0 : [...(project.intro ?? "")].length;
      let choices = 0;
      let texts = 0;
      const onText = (t: string) => {
        chars += [...t].length;
        texts++;
      };
      let state = settle(project, start ?? createInitialState(project), onText);
      for (const action of g.actions!) {
        if (action.kind === "event") steps += action.moves.length;
        if (action.kind === "choose") choices++;
        state = applyAction(project, state, action, onText);
      }
      chars += [...(project.endings.find((x) => x.id === state.endingId)?.text ?? "")].length;
      // 每則文字都要按一次「繼續」，所以也算一個操作
      return steps * SECONDS_PER_STEP + chars / CHARS_PER_SECOND + choices * SECONDS_PER_CHOICE + (g.actions!.length + texts) * SECONDS_PER_ACTION;
    });
}

export function toEstimate(seconds: number[]): DurationEstimate | null {
  if (seconds.length === 0) return null;
  const shortest = Math.min(...seconds) / 60;
  return {
    shortestMinutes: Math.round(shortest * 10) / 10,
    typicalMinutes: [Math.max(1, Math.round(shortest * PLAYER_FACTOR[0])), Math.max(1, Math.round(shortest * PLAYER_FACTOR[1]))],
  };
}

export function estimateDuration(project: GameProject, playtest: PlaytestReport, start?: PlayerState): DurationEstimate | null {
  return toEstimate(routeSeconds(project, playtest, start));
}
