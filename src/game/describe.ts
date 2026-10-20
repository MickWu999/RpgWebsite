import type { GameCondition, GameEffect, GameProject } from "./schema";

/** 把 condition / effect 轉成編輯器可讀的文字 */

export function describeCondition(p: GameProject, c: GameCondition): string {
  const quest = (id: string) => p.quests.find((q) => q.id === id)?.title ?? id;
  const item = (id: string) => p.items.find((i) => i.id === id)?.name ?? id;
  switch (c.type) {
    case "quest_completed":
      return `任務「${quest(c.questId)}」已完成`;
    case "quest_active":
      return `任務「${quest(c.questId)}」進行中`;
    case "has_item":
      return `持有「${item(c.itemId)}」×${c.count ?? 1}`;
    case "flag_equals":
      return `旗標 ${c.flag} = ${JSON.stringify(c.value)}`;
    case "stat_at_least":
      return `${c.stat} ≥ ${c.value}`;
    case "all":
      return c.conditions.map((x) => describeCondition(p, x)).join(" 且 ");
    case "any":
      return `（${c.conditions.map((x) => describeCondition(p, x)).join(" 或 ")}）`;
    case "not":
      return `非（${describeCondition(p, c.condition)}）`;
  }
}

export function describeEffect(p: GameProject, e: GameEffect): string {
  const item = (id: string) => p.items.find((i) => i.id === id)?.name ?? id;
  switch (e.type) {
    case "give_item":
      return `獲得「${item(e.itemId)}」×${e.count ?? 1}`;
    case "remove_item":
      return `移除「${item(e.itemId)}」×${e.count ?? 1}`;
    case "add_xp":
      return `經驗值 ${e.amount >= 0 ? "+" : ""}${e.amount}`;
    case "set_flag":
      return `設定旗標 ${e.flag} = ${JSON.stringify(e.value)}`;
    case "complete_quest":
      return `完成任務「${p.quests.find((q) => q.id === e.questId)?.title ?? e.questId}」`;
  }
}
