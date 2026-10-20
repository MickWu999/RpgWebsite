import type { EventCommand, EventPage, GameCondition, GameProject } from "./schema";

/** 把條件、事件頁條件與事件指令轉成 RPG Maker 式的可讀文字（編輯器、審查摘要、AI 閱讀共用） */

const QUEST_STATUS: Record<string, string> = { inactive: "未開始", active: "進行中", completed: "已完成", failed: "失敗" };

const nameOf = (list: Array<{ id: string; name?: string; title?: string }>, id: string) => {
  const x = list.find((v) => v.id === id);
  return x?.name ?? x?.title ?? id;
};

export function describeCondition(p: GameProject, c: GameCondition): string {
  switch (c.type) {
    case "switch":
      return `開關［${nameOf(p.switches, c.id)}］為 ${c.value ? "ON" : "OFF"}`;
    case "variable":
      return `變數［${nameOf(p.variables, c.id)}］${c.op} ${c.value}`;
    case "selfSwitch":
      return `獨立開關 ${c.key} 為 ${c.value ? "ON" : "OFF"}`;
    case "item":
      return `持有［${nameOf(p.items, c.itemId)}］${c.count && c.count > 1 ? `×${c.count}` : ""}`;
    case "quest":
      return `任務［${nameOf(p.quests, c.questId)}］${QUEST_STATUS[c.status]}${c.step !== undefined ? `（第 ${c.step + 1} 步）` : ""}`;
    case "chapter":
      return `目前章節是［${nameOf(p.chapters, c.chapterId)}］`;
    case "all":
      return c.conditions.map((x) => describeCondition(p, x)).join(" 且 ");
    case "any":
      return `（${c.conditions.map((x) => describeCondition(p, x)).join(" 或 ")}）`;
    case "not":
      return `非（${describeCondition(p, c.condition)}）`;
  }
}

export function describePageConditions(p: GameProject, page: EventPage): string {
  const c = page.conditions;
  const parts: string[] = [];
  c?.switches?.forEach((id) => parts.push(`開關［${nameOf(p.switches, id)}］ON`));
  if (c?.variable) parts.push(`變數［${nameOf(p.variables, c.variable.id)}］≥ ${c.variable.min}`);
  if (c?.selfSwitch) parts.push(`獨立開關 ${c.selfSwitch} ON`);
  if (c?.itemId) parts.push(`持有［${nameOf(p.items, c.itemId)}］`);
  if (c?.quest) parts.push(`任務［${nameOf(p.quests, c.quest.questId)}］${QUEST_STATUS[c.quest.status]}`);
  if (c?.custom) parts.push(describeCondition(p, c.custom));
  return parts.length ? parts.join("、") : "無條件";
}

export const TRIGGER_LABEL = { action: "確定鍵", touch: "接觸", autorun: "自動執行" } as const;
export const PRIORITY_LABEL = { below: "在角色下", same: "與角色同層", above: "在角色上" } as const;

/** 單一指令的一行描述（不含巢狀內容） */
export function describeCommand(p: GameProject, c: EventCommand): string {
  switch (c.code) {
    case "text": {
      const who = c.speaker ?? (c.actorId ? nameOf(p.actors, c.actorId) : "");
      return `文字：${who ? `${who}：` : ""}${c.text.replace(/\n/g, "／")}`;
    }
    case "choices":
      return `顯示選項：${c.options.map((o) => o.text).join("／")}`;
    case "if":
      return `條件分支：${describeCondition(p, c.condition)}`;
    case "switch":
      return `開關操作：${c.ids.map((id) => nameOf(p.switches, id)).join("、")} = ${c.value ? "ON" : "OFF"}`;
    case "selfSwitch":
      return `獨立開關操作：${c.key} = ${c.value ? "ON" : "OFF"}`;
    case "variable":
      return `變數操作：${nameOf(p.variables, c.id)} ${c.op === "set" ? "=" : c.op === "add" ? "+=" : "-="} ${c.value}`;
    case "item":
      return `增減物品：${nameOf(p.items, c.itemId)} ${c.delta > 0 ? "+" : ""}${c.delta}`;
    case "quest": {
      const q = p.quests.find((x) => x.id === c.questId);
      const label = { start: "開始", step: "前進到", complete: "完成", fail: "失敗" }[c.action];
      const step = c.action === "step" && c.step !== undefined ? `第 ${c.step + 1} 步「${q?.steps[c.step]?.text ?? ""}」` : "";
      return `任務：${label}［${q?.title ?? c.questId}］${step}`;
    }
    case "transfer":
      return `場所移動：${nameOf(p.maps, c.mapId)} (${c.x},${c.y})`;
    case "ending":
      return `結局：${nameOf(p.endings, c.endingId)}`;
    case "chapter":
      return `章節：${nameOf(p.chapters, c.chapterId)}`;
    case "common":
      return `共用事件：${nameOf(p.commonEvents, c.id)}`;
    case "erase":
      return "暫時消除事件";
    case "exit":
      return "中斷事件處理";
    case "label":
      return `標籤：${c.name}`;
    case "jump":
      return `跳轉到標籤：${c.name}`;
    case "wait":
      return `等待：${c.ms} 毫秒`;
    case "music":
      return `播放背景音樂：${c.mood ?? "停止"}`;
    case "comment":
      return `註解：${c.text}`;
  }
}

/** 整個指令列的縮排文字（RPG Maker 執行內容的樣子） */
export function describeCommandList(p: GameProject, list: EventCommand[], indent = ""): string[] {
  const lines: string[] = [];
  for (const c of list) {
    lines.push(`${indent}◆${describeCommand(p, c)}`);
    if (c.code === "if") {
      lines.push(...describeCommandList(p, c.then, `${indent}  `));
      if (c.else?.length) {
        lines.push(`${indent}：除此之外`);
        lines.push(...describeCommandList(p, c.else, `${indent}  `));
      }
      lines.push(`${indent}：分支結束`);
    }
    if (c.code === "choices") {
      c.options.forEach((o) => {
        lines.push(`${indent}：選擇「${o.text}」時${o.condition ? `［條件：${describeCondition(p, o.condition)}］` : ""}`);
        lines.push(...describeCommandList(p, o.commands, `${indent}  `));
      });
      lines.push(`${indent}：分支結束`);
    }
  }
  return lines;
}
