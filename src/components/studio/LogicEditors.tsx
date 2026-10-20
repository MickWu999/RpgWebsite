"use client";

import type { GameCondition, GameEffect, GameProject } from "@/game/schema";

/** 條件與效果的視覺化編輯器（RPG Maker 事件頁的「出現條件」與「事件指令」） */

const CONDITION_LABELS: Record<GameCondition["type"], string> = {
  quest_active: "任務進行中",
  quest_completed: "任務已完成",
  has_item: "持有物品",
  flag_equals: "旗標等於",
  stat_at_least: "數值至少",
  all: "以下全部成立",
  any: "以下任一成立",
  not: "以下不成立",
};

function defaultCondition(type: GameCondition["type"], p: GameProject): GameCondition {
  switch (type) {
    case "quest_active":
    case "quest_completed":
      return { type, questId: p.quests[0]?.id ?? "quest" };
    case "has_item":
      return { type, itemId: p.items[0]?.id ?? "item" };
    case "flag_equals":
      return { type, flag: "flag", value: true };
    case "stat_at_least":
      return { type, stat: "level", value: 2 };
    case "all":
    case "any":
      return { type, conditions: [{ type: "flag_equals", flag: "flag", value: true }] };
    case "not":
      return { type, condition: { type: "flag_equals", flag: "flag", value: true } };
  }
}

function parseFlagValue(text: string): string | number | boolean {
  if (text === "true") return true;
  if (text === "false") return false;
  if (text.trim() !== "" && !Number.isNaN(Number(text))) return Number(text);
  return text;
}

export function ConditionEditor({ project, value, onChange }: { project: GameProject; value: GameCondition; onChange: (c: GameCondition) => void }) {
  const select = (
    <select value={value.type} onChange={(e) => onChange(defaultCondition(e.target.value as GameCondition["type"], project))}>
      {Object.entries(CONDITION_LABELS).map(([k, v]) => (
        <option key={k} value={k}>
          {v}
        </option>
      ))}
    </select>
  );
  const questSelect = (questId: string, set: (id: string) => void) => (
    <select value={questId} onChange={(e) => set(e.target.value)}>
      {project.quests.map((q) => (
        <option key={q.id} value={q.id}>
          {q.title}
        </option>
      ))}
    </select>
  );
  switch (value.type) {
    case "quest_active":
    case "quest_completed":
      return (
        <div className="logic-row">
          {select}
          {questSelect(value.questId, (questId) => onChange({ ...value, questId }))}
        </div>
      );
    case "has_item":
      return (
        <div className="logic-row">
          {select}
          <ItemSelect project={project} value={value.itemId} onChange={(itemId) => onChange({ ...value, itemId })} />
          <input type="number" min={1} value={value.count ?? 1} onChange={(e) => onChange({ ...value, count: Number(e.target.value) || 1 })} />
        </div>
      );
    case "flag_equals":
      return (
        <div className="logic-row">
          {select}
          <input type="text" value={value.flag} placeholder="旗標名稱" onChange={(e) => onChange({ ...value, flag: e.target.value.replace(/[^A-Za-z0-9_-]/g, "") })} />
          <span>=</span>
          <input type="text" value={String(value.value)} placeholder="true / 數字 / 文字" onChange={(e) => onChange({ ...value, value: parseFlagValue(e.target.value) })} />
        </div>
      );
    case "stat_at_least":
      return (
        <div className="logic-row">
          {select}
          <select value={value.stat} onChange={(e) => onChange({ ...value, stat: e.target.value as "hp" | "level" | "xp" })}>
            <option value="level">等級</option>
            <option value="xp">經驗值</option>
            <option value="hp">HP</option>
          </select>
          <input type="number" value={value.value} onChange={(e) => onChange({ ...value, value: Number(e.target.value) || 0 })} />
        </div>
      );
    case "all":
    case "any":
      return (
        <div className="logic-group">
          <div className="logic-row">{select}</div>
          {value.conditions.map((c, i) => (
            <div key={i} className="logic-nested">
              <ConditionEditor project={project} value={c} onChange={(nc) => onChange({ ...value, conditions: value.conditions.map((x, j) => (j === i ? nc : x)) })} />
              <button className="btn small" disabled={value.conditions.length <= 1} onClick={() => onChange({ ...value, conditions: value.conditions.filter((_, j) => j !== i) })}>
                移除
              </button>
            </div>
          ))}
          <button className="btn small" onClick={() => onChange({ ...value, conditions: [...value.conditions, { type: "flag_equals", flag: "flag", value: true }] })}>
            ＋ 條件
          </button>
        </div>
      );
    case "not":
      return (
        <div className="logic-group">
          <div className="logic-row">{select}</div>
          <div className="logic-nested">
            <ConditionEditor project={project} value={value.condition} onChange={(condition) => onChange({ ...value, condition })} />
          </div>
        </div>
      );
  }
}

const EFFECT_LABELS: Record<GameEffect["type"], string> = {
  give_item: "給予物品",
  remove_item: "移除物品",
  set_flag: "設定旗標",
  add_xp: "增加經驗值",
  complete_quest: "完成任務",
};

function defaultEffect(type: GameEffect["type"], p: GameProject): GameEffect {
  switch (type) {
    case "give_item":
    case "remove_item":
      return { type, itemId: p.items[0]?.id ?? "item" };
    case "set_flag":
      return { type, flag: "flag", value: true };
    case "add_xp":
      return { type, amount: 50 };
    case "complete_quest":
      return { type, questId: p.quests[0]?.id ?? "quest" };
  }
}

function ItemSelect({ project, value, onChange }: { project: GameProject; value: string; onChange: (id: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {project.items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
        </option>
      ))}
    </select>
  );
}

export function EffectsEditor({ project, value, onChange }: { project: GameProject; value: GameEffect[]; onChange: (e: GameEffect[]) => void }) {
  const set = (i: number, e: GameEffect) => onChange(value.map((x, j) => (j === i ? e : x)));
  return (
    <div className="logic-group">
      {value.map((e, i) => (
        <div key={i} className="logic-row">
          <select value={e.type} onChange={(ev) => set(i, defaultEffect(ev.target.value as GameEffect["type"], project))}>
            {Object.entries(EFFECT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {(e.type === "give_item" || e.type === "remove_item") && (
            <>
              <ItemSelect project={project} value={e.itemId} onChange={(itemId) => set(i, { ...e, itemId })} />
              <input type="number" min={1} value={e.count ?? 1} onChange={(ev) => set(i, { ...e, count: Number(ev.target.value) || 1 })} />
            </>
          )}
          {e.type === "set_flag" && (
            <>
              <input type="text" value={e.flag} onChange={(ev) => set(i, { ...e, flag: ev.target.value.replace(/[^A-Za-z0-9_-]/g, "") })} />
              <span>=</span>
              <input type="text" value={String(e.value)} onChange={(ev) => set(i, { ...e, value: parseFlagValue(ev.target.value) })} />
            </>
          )}
          {e.type === "add_xp" && <input type="number" value={e.amount} onChange={(ev) => set(i, { ...e, amount: Number(ev.target.value) || 0 })} />}
          {e.type === "complete_quest" && (
            <select value={e.questId} onChange={(ev) => set(i, { ...e, questId: ev.target.value })}>
              {project.quests.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title}
                </option>
              ))}
            </select>
          )}
          <button className="btn small" onClick={() => onChange(value.filter((_, j) => j !== i))}>
            移除
          </button>
        </div>
      ))}
      <button className="btn small" onClick={() => onChange([...value, { type: "set_flag", flag: "flag", value: true }])}>
        ＋ 效果
      </button>
    </div>
  );
}

/** 事件頁（RPG Maker 式）：依條件切換的對話入口，由上往下第一個成立的分頁生效 */
export function VariantPages({
  project,
  base,
  variants,
  onChange,
}: {
  project: GameProject;
  base: string;
  variants: Array<{ condition: GameCondition; dialogueNodeId: string }>;
  onChange: (base: string, variants: Array<{ condition: GameCondition; dialogueNodeId: string }>) => void;
}) {
  const nodeSelect = (value: string, set: (id: string) => void) => (
    <select value={value} onChange={(e) => set(e.target.value)}>
      {project.dialogues.map((d) => (
        <option key={d.id} value={d.id}>
          {d.id}：{d.text.slice(0, 16)}
        </option>
      ))}
    </select>
  );
  return (
    <div className="stack" style={{ gap: 8 }}>
      {variants.map((v, i) => (
        <div key={i} className="event-page">
          <div className="row small">
            <strong>分頁 {i + 1}</strong>
            <span className="muted">（條件成立時優先）</span>
            <span className="grow" />
            <button className="btn small" disabled={i === 0} onClick={() => onChange(base, variants.map((x, j) => (j === i - 1 ? variants[i] : j === i ? variants[i - 1] : x)))}>
              ↑
            </button>
            <button className="btn small" onClick={() => onChange(base, variants.filter((_, j) => j !== i))}>
              刪除
            </button>
          </div>
          <ConditionEditor project={project} value={v.condition} onChange={(condition) => onChange(base, variants.map((x, j) => (j === i ? { ...x, condition } : x)))} />
          <div className="logic-row small">對話：{nodeSelect(v.dialogueNodeId, (id) => onChange(base, variants.map((x, j) => (j === i ? { ...x, dialogueNodeId: id } : x))))}</div>
        </div>
      ))}
      <div className="event-page">
        <div className="small">
          <strong>預設分頁</strong> <span className="muted">（以上都不成立時）</span>
        </div>
        <div className="logic-row small">對話：{nodeSelect(base, (id) => onChange(id, variants))}</div>
      </div>
      <button className="btn small" onClick={() => onChange(base, [...variants, { condition: { type: "flag_equals", flag: "flag", value: true }, dialogueNodeId: base }])}>
        ＋ 新增分頁
      </button>
    </div>
  );
}
