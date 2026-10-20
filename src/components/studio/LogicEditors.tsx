"use client";

import { ASSET_CATALOG, sheetColumns } from "@/game/assets";
import { COMPARE_OPS, QUEST_STATUSES, SELF_SWITCHES, type GameCondition, type GameProject } from "@/game/schema";

/**
 * 共用的選擇器與條件編輯器（RPG Maker 的「條件分支」與事件頁「出現條件」）。
 * 開關與變數可以直接輸入新的 ID：儲存時會自動加入資料庫（名稱預設為 ID，可在資料庫改名）。
 */

export const QUEST_STATUS_LABEL: Record<(typeof QUEST_STATUSES)[number], string> = { inactive: "未開始", active: "進行中", completed: "已完成", failed: "失敗" };

const NEW = "__new__";
const cleanId = (s: string) => s.trim().replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);

function askId(label: string) {
  const id = window.prompt(`新的${label} ID（英數字與底線，例如 met_sergeant）`);
  return id ? cleanId(id) : null;
}

/** 開關／變數：可選既有的，也可以新增 */
function NamedSelect({ list, value, onChange, label }: { list: Array<{ id: string; name: string }>; value: string; onChange: (id: string) => void; label: string }) {
  const known = list.some((x) => x.id === value);
  return (
    <select
      value={value}
      onChange={(e) => {
        if (e.target.value !== NEW) return onChange(e.target.value);
        const id = askId(label);
        if (id) onChange(id);
      }}
    >
      {!known && <option value={value}>{value || `（選擇${label}）`}</option>}
      {list.map((x) => (
        <option key={x.id} value={x.id}>
          {x.name}
          {x.name !== x.id ? `（${x.id}）` : ""}
        </option>
      ))}
      <option value={NEW}>＋ 新增{label}…</option>
    </select>
  );
}

export const SwitchSelect = ({ project, value, onChange }: { project: GameProject; value: string; onChange: (id: string) => void }) => (
  <NamedSelect list={project.switches} value={value} onChange={onChange} label="開關" />
);
export const VariableSelect = ({ project, value, onChange }: { project: GameProject; value: string; onChange: (id: string) => void }) => (
  <NamedSelect list={project.variables} value={value} onChange={onChange} label="變數" />
);

function RefSelect({ list, value, onChange, empty }: { list: Array<{ id: string; label: string }>; value: string; onChange: (id: string) => void; empty: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!list.some((x) => x.id === value) && <option value={value}>{value || empty}</option>}
      {list.map((x) => (
        <option key={x.id} value={x.id}>
          {x.label}
        </option>
      ))}
    </select>
  );
}

export const ItemSelect = ({ project, value, onChange }: { project: GameProject; value: string; onChange: (id: string) => void }) => (
  <RefSelect list={project.items.map((i) => ({ id: i.id, label: i.name }))} value={value} onChange={onChange} empty="（先在資料庫新增物品）" />
);
export const QuestSelect = ({ project, value, onChange }: { project: GameProject; value: string; onChange: (id: string) => void }) => (
  <RefSelect list={project.quests.map((q) => ({ id: q.id, label: q.title }))} value={value} onChange={onChange} empty="（先在資料庫新增任務）" />
);
export const ActorSelect = ({ project, value, onChange }: { project: GameProject; value: string; onChange: (id: string) => void }) => (
  <RefSelect list={project.actors.map((a) => ({ id: a.id, label: a.name }))} value={value} onChange={onChange} empty="（選擇角色）" />
);
export const MapSelect = ({ project, value, onChange }: { project: GameProject; value: string; onChange: (id: string) => void }) => (
  <RefSelect list={project.maps.map((m) => ({ id: m.id, label: m.name }))} value={value} onChange={onChange} empty="（選擇地圖）" />
);
export const EndingSelect = ({ project, value, onChange }: { project: GameProject; value: string; onChange: (id: string) => void }) => (
  <RefSelect list={project.endings.map((e) => ({ id: e.id, label: e.title }))} value={value} onChange={onChange} empty="（先在資料庫新增結局）" />
);
export const ChapterSelect = ({ project, value, onChange }: { project: GameProject; value: string; onChange: (id: string) => void }) => (
  <RefSelect list={project.chapters.map((c) => ({ id: c.id, label: c.title }))} value={value} onChange={onChange} empty="（先在資料庫新增章節）" />
);
export const CommonEventSelect = ({ project, value, onChange }: { project: GameProject; value: string; onChange: (id: string) => void }) => (
  <RefSelect list={project.commonEvents.map((c) => ({ id: c.id, label: c.name }))} value={value} onChange={onChange} empty="（先在資料庫新增共用事件）" />
);

/** 素材挑選：角色圖或圖示，顯示縮圖 */
export function AssetPicker({ kind, value, onChange, allowNone }: { kind: "character" | "icon" | "any"; value: string | undefined; onChange: (id: string | undefined) => void; allowNone?: boolean }) {
  const list = ASSET_CATALOG.filter((a) => (kind === "any" ? a.kind !== "tileset" : a.kind === kind));
  return (
    <div className="asset-picker">
      {allowNone && (
        <button className={`asset-swatch${!value ? " active" : ""}`} onClick={() => onChange(undefined)} title="無（透明）">
          <span className="asset-none">無</span>
        </button>
      )}
      {list.map((a) => (
        <button key={a.id} className={`asset-swatch${value === a.id ? " active" : ""}`} onClick={() => onChange(a.id)} title={`${a.name}（${a.id}）`}>
          <AssetThumb src={a.src} frame={a.frame ?? 0} />
        </button>
      ))}
    </div>
  );
}

export function AssetThumb({ src, frame, size = 32 }: { src: string; frame: number; size?: number }) {
  const cols = sheetColumns(src);
  return (
    <span
      className="asset-thumb"
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${src})`,
        backgroundPosition: `-${(frame % cols) * size}px -${Math.floor(frame / cols) * size}px`,
        backgroundSize: `${cols * size}px auto`,
      }}
    />
  );
}

// ---------- 條件 ----------

const CONDITION_LABELS: Record<GameCondition["type"], string> = {
  switch: "開關",
  variable: "變數",
  selfSwitch: "獨立開關",
  item: "持有物品",
  quest: "任務狀態",
  chapter: "目前章節",
  all: "以下全部成立",
  any: "以下任一成立",
  not: "以下不成立",
};

export function defaultCondition(type: GameCondition["type"], p: GameProject): GameCondition {
  switch (type) {
    case "switch":
      return { type, id: p.switches[0]?.id ?? "", value: true };
    case "variable":
      return { type, id: p.variables[0]?.id ?? "", op: ">=", value: 1 };
    case "selfSwitch":
      return { type, key: "A", value: true };
    case "item":
      return { type, itemId: p.items[0]?.id ?? "" };
    case "quest":
      return { type, questId: p.quests[0]?.id ?? "", status: "active" };
    case "chapter":
      return { type, chapterId: p.chapters[0]?.id ?? "" };
    case "all":
    case "any":
      return { type, conditions: [defaultCondition("switch", p)] };
    case "not":
      return { type, condition: defaultCondition("switch", p) };
  }
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
  const onOff = (v: boolean, set: (v: boolean) => void) => (
    <select value={v ? "on" : "off"} onChange={(e) => set(e.target.value === "on")}>
      <option value="on">ON</option>
      <option value="off">OFF</option>
    </select>
  );
  switch (value.type) {
    case "switch":
      return (
        <div className="logic-row">
          {select}
          <SwitchSelect project={project} value={value.id} onChange={(id) => onChange({ ...value, id })} />
          <span>為</span>
          {onOff(value.value, (v) => onChange({ ...value, value: v }))}
        </div>
      );
    case "variable":
      return (
        <div className="logic-row">
          {select}
          <VariableSelect project={project} value={value.id} onChange={(id) => onChange({ ...value, id })} />
          <select value={value.op} onChange={(e) => onChange({ ...value, op: e.target.value as (typeof COMPARE_OPS)[number] })}>
            {COMPARE_OPS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          <input type="number" value={value.value} onChange={(e) => onChange({ ...value, value: Number(e.target.value) || 0 })} />
        </div>
      );
    case "selfSwitch":
      return (
        <div className="logic-row">
          {select}
          <select value={value.key} onChange={(e) => onChange({ ...value, key: e.target.value as (typeof SELF_SWITCHES)[number] })}>
            {SELF_SWITCHES.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <span>為</span>
          {onOff(value.value, (v) => onChange({ ...value, value: v }))}
        </div>
      );
    case "item":
      return (
        <div className="logic-row">
          {select}
          <ItemSelect project={project} value={value.itemId} onChange={(itemId) => onChange({ ...value, itemId })} />
          <span>×</span>
          <input type="number" min={1} value={value.count ?? 1} onChange={(e) => onChange({ ...value, count: Math.max(1, Number(e.target.value) || 1) })} />
        </div>
      );
    case "quest": {
      const quest = project.quests.find((q) => q.id === value.questId);
      return (
        <div className="logic-row">
          {select}
          <QuestSelect project={project} value={value.questId} onChange={(questId) => onChange({ ...value, questId, step: undefined })} />
          <select value={value.status} onChange={(e) => onChange({ ...value, status: e.target.value as (typeof QUEST_STATUSES)[number] })}>
            {QUEST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {QUEST_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          {value.status === "active" && quest && (
            <select value={value.step ?? ""} onChange={(e) => onChange({ ...value, step: e.target.value === "" ? undefined : Number(e.target.value) })}>
              <option value="">任何步驟</option>
              {quest.steps.map((st, i) => (
                <option key={i} value={i}>
                  第 {i + 1} 步：{st.text.slice(0, 12)}
                </option>
              ))}
            </select>
          )}
        </div>
      );
    }
    case "chapter":
      return (
        <div className="logic-row">
          {select}
          <ChapterSelect project={project} value={value.chapterId} onChange={(chapterId) => onChange({ ...value, chapterId })} />
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
          <button className="btn small" onClick={() => onChange({ ...value, conditions: [...value.conditions, defaultCondition("switch", project)] })}>
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
