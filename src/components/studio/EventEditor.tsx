"use client";

import { useState } from "react";
import { findCatalogAsset } from "@/game/assets";
import { PRIORITY_LABEL, TRIGGER_LABEL } from "@/game/describe";
import { SELF_SWITCHES, QUEST_STATUSES, type EventPage, type GameProject, type MapDefinition, type MapEvent, type PageConditions } from "@/game/schema";
import { CommandList } from "./CommandEditor";
import { AssetPicker, ConditionEditor, defaultCondition, ItemSelect, QUEST_STATUS_LABEL, QuestSelect, SwitchSelect, VariableSelect } from "./LogicEditors";

/**
 * 事件編輯視窗（RPG Maker 的「事件編輯」）：名稱、備註、事件頁籤；
 * 每頁左側是出現條件、圖像、觸發方式與優先度，右側是執行內容。
 * 系統每次都使用「條件成立、編號最大」的那一頁。
 */

export function uniqueEventId(map: MapDefinition, prefix = "ev") {
  for (let i = 1; ; i++) if (!map.events.some((e) => e.id === `${prefix}_${i}`)) return `${prefix}_${i}`;
}

export const emptyPage = (): EventPage => ({ trigger: "action", priority: "same", commands: [] });

export type QuickKind = "npc" | "door" | "chest" | "sign" | "zone" | "autorun";
export const QUICK_EVENTS: Array<[QuickKind, string, string]> = [
  ["npc", "👤 人物", "有角色圖、按確定鍵對話"],
  ["door", "🚪 場所移動", "踩上去就移到另一張地圖"],
  ["chest", "🎁 寶箱", "打開一次拿到物品（獨立開關 A）"],
  ["sign", "🪧 調查點", "門、告示、古井…按確定鍵看描述"],
  ["zone", "◻ 觸發區", "踩到時執行（例如劇情觸發）"],
  ["autorun", "▶ 自動執行", "進入地圖時自動播放一次（過場）"],
];

/** 快速事件建立（RPG Maker 的同名功能）：用範本建立常見的事件 */
export function quickEvent(kind: QuickKind, project: GameProject, map: MapDefinition, x: number, y: number): MapEvent {
  const actor = project.actors.find((a) => a.id !== project.system.playerActorId);
  const base = { x, y };
  switch (kind) {
    case "npc":
      return {
        ...base,
        id: uniqueEventId(map, "npc"),
        name: actor?.name ?? "村民",
        pages: [{ trigger: "action", priority: "same", graphic: { assetId: actor?.spriteAssetId ?? "char_villager" }, commands: [{ code: "text", text: "你好。", ...(actor ? { actorId: actor.id } : { speaker: "村民" }) }] }],
      };
    case "door": {
      const target = project.maps.find((m) => m.id !== map.id) ?? map;
      return { ...base, id: uniqueEventId(map, "door"), name: `往${target.name}`, pages: [{ trigger: "touch", priority: "below", commands: [{ code: "transfer", mapId: target.id, x: 1, y: 1 }] }] };
    }
    case "chest":
      return {
        ...base,
        id: uniqueEventId(map, "chest"),
        name: "寶箱",
        pages: [
          {
            trigger: "action",
            priority: "same",
            graphic: { assetId: "icon_chest" },
            commands: [
              { code: "text", text: "打開了寶箱。" },
              ...(project.items[0] ? [{ code: "item" as const, itemId: project.items[0].id, delta: 1 }] : [{ code: "comment" as const, text: "請在這裡加入「增減物品」" }]),
              { code: "selfSwitch", key: "A", value: true },
            ],
          },
          { trigger: "action", priority: "same", graphic: { assetId: "icon_chest" }, conditions: { selfSwitch: "A" }, commands: [{ code: "text", text: "寶箱是空的。" }] },
        ],
      };
    case "sign":
      return { ...base, id: uniqueEventId(map, "sign"), name: "告示牌", pages: [{ trigger: "action", priority: "same", commands: [{ code: "text", text: "上面寫著……", speaker: "告示牌" }] }] };
    case "zone":
      return { ...base, id: uniqueEventId(map, "zone"), name: "觸發區", pages: [{ trigger: "touch", priority: "below", commands: [{ code: "comment", text: "踩到時執行的內容" }] }] };
    case "autorun":
      return {
        ...base,
        id: uniqueEventId(map, "scene"),
        name: "過場",
        pages: [
          { trigger: "autorun", priority: "below", commands: [{ code: "text", text: "（過場的第一句）" }, { code: "selfSwitch", key: "A", value: true }] },
          { trigger: "action", priority: "below", conditions: { selfSwitch: "A" }, commands: [] },
        ],
      };
  }
}

export default function EventEditor({
  project,
  event,
  isNew,
  onOk,
  onCancel,
  onDelete,
}: {
  project: GameProject;
  event: MapEvent;
  isNew: boolean;
  onOk: (event: MapEvent, close: boolean) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<MapEvent>(() => structuredClone(event));
  const [pageIndex, setPageIndex] = useState(0);
  const page = draft.pages[Math.min(pageIndex, draft.pages.length - 1)];
  const setPage = (patch: Partial<EventPage>) => setDraft((d) => ({ ...d, pages: d.pages.map((p, i) => (i === pageIndex ? { ...p, ...patch } : p)) }));
  const setCond = (patch: Partial<PageConditions>) => {
    const next = { ...(page.conditions ?? {}), ...patch };
    for (const k of Object.keys(next) as Array<keyof PageConditions>) if (next[k] === undefined) delete next[k];
    setPage({ conditions: Object.keys(next).length ? next : undefined });
  };
  const c = page.conditions ?? {};
  const graphicKind = page.graphic ? findCatalogAsset(page.graphic.assetId)?.kind : undefined;

  return (
    <div className="db-overlay" onKeyDown={(e) => e.key === "Escape" && onCancel()}>
      <div className="db-window event-window" data-testid="event-editor">
        <div className="event-head">
          <label className="field">
            名稱
            <input type="text" value={draft.name} maxLength={200} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="event-name" />
          </label>
          <label className="field">
            ID
            <input type="text" value={draft.id} disabled={!isNew} onChange={(e) => setDraft({ ...draft, id: e.target.value.replace(/[^A-Za-z0-9_-]/g, "") })} />
          </label>
          <label className="field grow">
            備註（給自己與 AI 看）
            <input type="text" value={draft.note ?? ""} maxLength={1000} onChange={(e) => setDraft({ ...draft, note: e.target.value || undefined })} />
          </label>
          <div className="small muted">
            位置 ({draft.x},{draft.y})
          </div>
        </div>
        <div className="db-tabs">
          {draft.pages.map((_, i) => (
            <button key={i} className={i === pageIndex ? "active" : ""} onClick={() => setPageIndex(i)} data-testid={`page-tab-${i + 1}`}>
              {i + 1}
            </button>
          ))}
          <span className="grow" />
          <button className="btn small" disabled={draft.pages.length >= 20} onClick={() => {
              setDraft({ ...draft, pages: [...draft.pages, emptyPage()] });
              setPageIndex(draft.pages.length);
            }} data-testid="add-page">
            ＋ 新增頁
          </button>
          <button className="btn small" disabled={draft.pages.length >= 20} onClick={() => {
              setDraft({ ...draft, pages: [...draft.pages, structuredClone(page)] });
              setPageIndex(draft.pages.length);
            }}>
            複製此頁
          </button>
          <button className="btn small danger" disabled={draft.pages.length <= 1} onClick={() => {
              setDraft({ ...draft, pages: draft.pages.filter((_, i) => i !== pageIndex) });
              setPageIndex(Math.max(0, pageIndex - 1));
            }}>
            刪除此頁
          </button>
        </div>
        <div className="event-body">
          <div className="event-side stack">
            <div className="panel-section stack" style={{ gap: 6 }}>
              <div className="section-title">出現條件（全部成立時使用這一頁）</div>
              {[0, 1].map((slot) => (
                <div key={slot} className="logic-row">
                  <input
                    type="checkbox"
                    checked={c.switches?.[slot] !== undefined}
                    onChange={(e) => {
                      const list = [...(c.switches ?? [])];
                      if (e.target.checked) list[slot] = project.switches[0]?.id ?? "switch_1";
                      else list.splice(slot, 1);
                      setCond({ switches: list.filter(Boolean).length ? list.filter(Boolean) : undefined });
                    }}
                  />
                  <span>開關</span>
                  {c.switches?.[slot] !== undefined && (
                    <>
                      <SwitchSelect project={project} value={c.switches[slot]} onChange={(id) => setCond({ switches: c.switches!.map((x, j) => (j === slot ? id : x)) })} />
                      <span>ON</span>
                    </>
                  )}
                </div>
              ))}
              <div className="logic-row">
                <input type="checkbox" checked={Boolean(c.variable)} onChange={(e) => setCond({ variable: e.target.checked ? { id: project.variables[0]?.id ?? "var_1", min: 1 } : undefined })} />
                <span>變數</span>
                {c.variable && (
                  <>
                    <VariableSelect project={project} value={c.variable.id} onChange={(id) => setCond({ variable: { ...c.variable!, id } })} />
                    <span>≥</span>
                    <input type="number" value={c.variable.min} onChange={(e) => setCond({ variable: { ...c.variable!, min: Number(e.target.value) || 0 } })} />
                  </>
                )}
              </div>
              <div className="logic-row">
                <input type="checkbox" checked={Boolean(c.selfSwitch)} onChange={(e) => setCond({ selfSwitch: e.target.checked ? "A" : undefined })} />
                <span>獨立開關</span>
                {c.selfSwitch && (
                  <>
                    <select value={c.selfSwitch} onChange={(e) => setCond({ selfSwitch: e.target.value as (typeof SELF_SWITCHES)[number] })}>
                      {SELF_SWITCHES.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                    <span>ON</span>
                  </>
                )}
              </div>
              <div className="logic-row">
                <input type="checkbox" checked={Boolean(c.itemId)} onChange={(e) => setCond({ itemId: e.target.checked ? (project.items[0]?.id ?? "") : undefined })} />
                <span>持有物品</span>
                {c.itemId !== undefined && <ItemSelect project={project} value={c.itemId} onChange={(itemId) => setCond({ itemId })} />}
              </div>
              <div className="logic-row">
                <input type="checkbox" checked={Boolean(c.quest)} onChange={(e) => setCond({ quest: e.target.checked ? { questId: project.quests[0]?.id ?? "", status: "active" } : undefined })} />
                <span>任務</span>
                {c.quest && (
                  <>
                    <QuestSelect project={project} value={c.quest.questId} onChange={(questId) => setCond({ quest: { ...c.quest!, questId } })} />
                    <select value={c.quest.status} onChange={(e) => setCond({ quest: { ...c.quest!, status: e.target.value as (typeof QUEST_STATUSES)[number] } })}>
                      {QUEST_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {QUEST_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
              <div className="logic-row">
                <input type="checkbox" checked={Boolean(c.custom)} onChange={(e) => setCond({ custom: e.target.checked ? defaultCondition("all", project) : undefined })} />
                <span>進階條件</span>
              </div>
              {c.custom && <ConditionEditor project={project} value={c.custom} onChange={(custom) => setCond({ custom })} />}
            </div>
            <div className="panel-section stack" style={{ gap: 6 }}>
              <div className="section-title">圖像</div>
              <AssetPicker kind="any" allowNone value={page.graphic?.assetId} onChange={(id) => setPage({ graphic: id ? { assetId: id } : undefined })} />
              {page.graphic && graphicKind === "character" && (
                <label className="small">
                  <input
                    type="checkbox"
                    checked={page.graphic.direction === "left"}
                    onChange={(e) => setPage({ graphic: { ...page.graphic!, direction: e.target.checked ? "left" : undefined } })}
                  />{" "}
                  面向左邊
                </label>
              )}
            </div>
            <div className="panel-section stack" style={{ gap: 6 }}>
              <label className="field">
                觸發方式
                <select value={page.trigger} onChange={(e) => setPage({ trigger: e.target.value as EventPage["trigger"] })} data-testid="page-trigger">
                  {Object.entries(TRIGGER_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                優先度
                <select value={page.priority} onChange={(e) => setPage({ priority: e.target.value as EventPage["priority"] })}>
                  {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <div className="small muted">
                {page.trigger === "action" && (page.priority === "same" ? "玩家面對它按確定鍵時執行。" : "玩家站在上面按確定鍵時執行。")}
                {page.trigger === "touch" && (page.priority === "same" ? "玩家撞到它時執行。" : "玩家走上去時執行（例如場所移動）。")}
                {page.trigger === "autorun" && "這一頁成立時自動執行，玩家不能移動；最後要打開獨立開關或關閉開關，否則會一直重複。"}
              </div>
            </div>
          </div>
          <div className="event-commands">
            <div className="section-title">執行內容</div>
            <CommandList project={project} commands={page.commands} onChange={(commands) => setPage({ commands })} />
          </div>
        </div>
        <div className="row event-foot">
          {!isNew && (
            <button className="btn small danger" onClick={() => window.confirm(`刪除事件「${draft.name}」？`) && onDelete()}>
              刪除事件
            </button>
          )}
          <span className="grow" />
          <button className="btn small" onClick={onCancel}>
            取消
          </button>
          <button className="btn small" onClick={() => onOk(draft, false)} disabled={!draft.id || !draft.name}>
            套用
          </button>
          <button className="btn small primary" onClick={() => onOk(draft, true)} disabled={!draft.id || !draft.name} data-testid="event-ok">
            確定
          </button>
        </div>
      </div>
    </div>
  );
}

/** 專案中所有已使用的 ID（建立新資料時避免重複） */
export function allIds(p: GameProject) {
  return [...p.actors, ...p.items, ...p.quests, ...p.endings, ...p.chapters, ...p.commonEvents, ...p.maps].map((x) => x.id);
}
