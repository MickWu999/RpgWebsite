"use client";

import { useState } from "react";
import IssueList from "@/components/IssueList";
import { ASSET_CATALOG, LICENSES, MUSIC_MOODS } from "@/game/assets";
import { describeCondition, describeEffect } from "@/game/describe";
import {
  GENRE_LABELS,
  type DialogueNode,
  type EndingDefinition,
  type GameProject,
  type ItemDefinition,
  type QuestDefinition,
  type QuestObjective,
} from "@/game/schema";
import type { ValidationReport } from "@/game/validate";
import type { StudioOp } from "@/studio/ops";
import { ConditionEditor, EffectsEditor } from "./LogicEditors";
import { allIds } from "./EventEditor";

/** 資料庫視窗（RPG Maker 的 F9 資料庫）：對話、任務、物品、結局、系統、素材、驗證 */

export type DbTab = "dialogues" | "quests" | "items" | "endings" | "system" | "assets" | "validation";
const TABS: Array<[DbTab, string]> = [
  ["dialogues", "對話"],
  ["quests", "任務"],
  ["items", "物品"],
  ["endings", "結局"],
  ["system", "系統"],
  ["assets", "素材"],
  ["validation", "驗證"],
];
const icons = ASSET_CATALOG.filter((a) => a.kind === "icon");
const characters = ASSET_CATALOG.filter((a) => a.kind === "character");

function uniqueId(prefix: string, taken: string[]) {
  for (let i = 1; ; i++) if (!taken.includes(`${prefix}_${i}`)) return `${prefix}_${i}`;
}

export default function Database({
  project,
  report,
  tab,
  focusId,
  dispatch,
  onTab,
  onClose,
}: {
  project: GameProject;
  report: ValidationReport;
  tab: DbTab;
  focusId: string | null;
  dispatch: (ops: StudioOp[]) => void;
  onTab: (tab: DbTab, focusId?: string | null) => void;
  onClose: () => void;
}) {
  const ids = allIds(project);
  const list = (rows: Array<{ id: string; label: string }>, onAdd: () => void) => (
    <div className="db-list">
      <button className="btn small" onClick={onAdd}>
        ＋ 新增
      </button>
      {rows.map((r) => (
        <button key={r.id} className={`db-row${focusId === r.id ? " active" : ""}`} onClick={() => onTab(tab, r.id)}>
          <span className="mono small">{r.id}</span>
          <span>{r.label}</span>
        </button>
      ))}
    </div>
  );

  let body: React.ReactNode = null;
  if (tab === "dialogues") {
    const node = project.dialogues.find((d) => d.id === focusId) ?? project.dialogues[0];
    body = (
      <>
        {list(
          project.dialogues.map((d) => ({ id: d.id, label: `${d.speaker}：${d.text.slice(0, 14)}` })),
          () => {
            const id = uniqueId("dlg", ids);
            dispatch([{ op: "dialogue.upsert", node: { id, speaker: "說話者", text: "台詞" } }]);
            onTab("dialogues", id);
          },
        )}
        {node && <DialogueForm key={JSON.stringify(node)} project={project} node={node} dispatch={dispatch} onJump={(id) => onTab("dialogues", id)} ids={ids} />}
      </>
    );
  } else if (tab === "quests") {
    const quest = project.quests.find((q) => q.id === focusId) ?? project.quests[0];
    body = (
      <>
        {list(
          project.quests.map((q) => ({ id: q.id, label: q.title })),
          () => {
            const id = uniqueId("quest", ids);
            dispatch([
              {
                op: "quest.upsert",
                quest: { id, title: "新任務", description: "", objectives: [{ id: "o1", type: "talk_to_npc", targetId: project.npcs[0]?.id ?? "npc", description: "和某人說話" }] },
              },
            ]);
            onTab("quests", id);
          },
        )}
        {quest && <QuestForm key={JSON.stringify(quest)} project={project} quest={quest} dispatch={dispatch} />}
      </>
    );
  } else if (tab === "items") {
    const item = project.items.find((i) => i.id === focusId) ?? project.items[0];
    body = (
      <>
        {list(
          project.items.map((i) => ({ id: i.id, label: i.name })),
          () => {
            const id = uniqueId("item", ids);
            dispatch([{ op: "item.upsert", item: { id, name: "新物品", description: "", iconAssetId: icons[0].id } }]);
            onTab("items", id);
          },
        )}
        {item && <ItemForm key={JSON.stringify(item)} item={item} dispatch={dispatch} />}
      </>
    );
  } else if (tab === "endings") {
    const ending = project.endings.find((e) => e.id === focusId) ?? project.endings[0];
    body = (
      <>
        {list(
          project.endings.map((e) => ({ id: e.id, label: e.title })),
          () => {
            const id = uniqueId("ending", [...ids, ...project.endings.map((e) => e.id)]);
            dispatch([{ op: "ending.upsert", ending: { id, title: "新結局", text: "結局文字", condition: { type: "flag_equals", flag: "ending", value: id } } }]);
            onTab("endings", id);
          },
        )}
        {ending && <EndingForm key={JSON.stringify(ending)} project={project} ending={ending} dispatch={dispatch} />}
      </>
    );
  } else if (tab === "system") {
    body = <SystemForm key={JSON.stringify([project.title, project.cover, project.player, project.intro])} project={project} dispatch={dispatch} />;
  } else if (tab === "assets") {
    body = (
      <div className="db-form stack">
        <p className="small muted">遊戲只引用素材 ID；素材全部來自內建素材庫（CC0），授權資訊由素材庫產生。</p>
        {Object.values(LICENSES).map((l) => (
          <div key={l.packId} className="sub small">
            <strong>{l.packName}</strong>（{l.author}）・{l.license}・可商用：{l.commercialUse ? "是" : "否"}・需署名：{l.attributionRequired ? "是" : "否"}
            <div>
              來源：<a href={l.sourceUrl}>{l.sourceUrl}</a>・下載日期：{l.downloadedAt}
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    body = (
      <div className="db-form stack">
        <div className={`badge ${report.isValid ? "ok" : "err"}`}>{report.isValid ? "驗證通過" : `${report.errors.length} 個錯誤`}</div>
        <IssueList errors={report.errors} warnings={report.warnings} />
      </div>
    );
  }

  return (
    <div className="db-overlay" data-testid="database">
      <div className="db-window">
        <div className="db-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={tab === key ? "active" : ""} onClick={() => onTab(key, null)}>
              {label}
            </button>
          ))}
          <span className="grow" />
          <button className="btn small" onClick={onClose}>
            關閉（Esc）
          </button>
        </div>
        <div className="db-body">{body}</div>
      </div>
    </div>
  );
}

function FormActions({ onOk, onDelete }: { onOk: () => void; onDelete?: () => void }) {
  return (
    <div className="row">
      <button className="btn small primary" onClick={onOk}>
        確定
      </button>
      {onDelete && (
        <button className="btn small danger" onClick={onDelete}>
          刪除
        </button>
      )}
    </div>
  );
}

function DialogueForm({ project, node, dispatch, onJump, ids }: { project: GameProject; node: DialogueNode; dispatch: (ops: StudioOp[]) => void; onJump: (id: string) => void; ids: string[] }) {
  const [d, setD] = useState(node);
  const choices = d.choices ?? [];
  const setChoice = (i: number, patch: Partial<(typeof choices)[number]>) => setD({ ...d, choices: choices.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  return (
    <div className="db-form stack">
      <div className="row">
        <span className="badge mono">{d.id}</span>
      </div>
      <label className="field">
        說話者
        <input type="text" value={d.speaker} onChange={(e) => setD({ ...d, speaker: e.target.value })} />
      </label>
      <label className="field">
        台詞
        <textarea rows={3} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} />
      </label>
      <div className="small muted">選項（沒有選項時顯示「繼續」並結束對話）</div>
      {choices.map((c, i) => (
        <div key={i} className="event-page stack" style={{ gap: 6 }}>
          <div className="row">
            <input type="text" value={c.text} onChange={(e) => setChoice(i, { text: e.target.value })} />
            <button className="btn small" onClick={() => setD({ ...d, choices: choices.filter((_, j) => j !== i) })}>
              移除
            </button>
          </div>
          <div className="logic-row small">
            下一句
            <select value={c.nextNodeId ?? ""} onChange={(e) => setChoice(i, { nextNodeId: e.target.value || undefined })}>
              <option value="">（結束對話）</option>
              {project.dialogues.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id}：{n.text.slice(0, 14)}
                </option>
              ))}
            </select>
            {c.nextNodeId && (
              <button className="btn small" onClick={() => onJump(c.nextNodeId!)}>
                前往 →
              </button>
            )}
          </div>
          <div className="small muted">效果</div>
          <EffectsEditor project={project} value={c.effects ?? []} onChange={(effects) => setChoice(i, { effects: effects.length ? effects : undefined })} />
          <label className="small">
            <input type="checkbox" checked={Boolean(c.condition)} onChange={(e) => setChoice(i, { condition: e.target.checked ? { type: "flag_equals", flag: "flag", value: true } : undefined })} /> 只在條件成立時顯示這個選項
          </label>
          {c.condition && <ConditionEditor project={project} value={c.condition} onChange={(condition) => setChoice(i, { condition })} />}
        </div>
      ))}
      <button className="btn small" onClick={() => setD({ ...d, choices: [...choices, { id: uniqueId(`${d.id}_c`, [...ids, ...choices.map((c) => c.id)]), text: "選項" }] })}>
        ＋ 選項
      </button>
      <FormActions onOk={() => dispatch([{ op: "dialogue.upsert", node: { ...d, choices: choices.length ? choices : undefined } }])} onDelete={() => dispatch([{ op: "dialogue.remove", id: node.id }])} />
    </div>
  );
}

const OBJECTIVE_LABELS: Record<QuestObjective["type"], string> = {
  talk_to_npc: "和 NPC 說話",
  collect_item: "收集物品",
  reach_location: "抵達地點",
  make_choice: "做出選擇",
  inspect: "調查物件",
};

function targetOptions(p: GameProject, type: QuestObjective["type"]) {
  switch (type) {
    case "talk_to_npc":
      return p.npcs.map((n) => ({ id: n.id, label: n.name }));
    case "collect_item":
      return p.items.map((i) => ({ id: i.id, label: i.name }));
    case "reach_location":
      return p.scenes.flatMap((s) => (s.locations ?? []).map((l) => ({ id: l.id, label: `${s.name}／${l.name}` })));
    case "make_choice":
      return p.dialogues.flatMap((d) => (d.choices ?? []).map((c) => ({ id: c.id, label: `${d.speaker}：${c.text.slice(0, 16)}` })));
    case "inspect":
      return p.scenes.flatMap((s) => (s.interactables ?? []).map((o) => ({ id: o.id, label: `${s.name}／${o.name}` })));
  }
}

function QuestForm({ project, quest, dispatch }: { project: GameProject; quest: QuestDefinition; dispatch: (ops: StudioOp[]) => void }) {
  const [d, setD] = useState(quest);
  const setObj = (i: number, patch: Partial<QuestObjective>) => setD({ ...d, objectives: d.objectives.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  return (
    <div className="db-form stack">
      <span className="badge mono">{d.id}</span>
      <label className="field">
        任務名稱
        <input type="text" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
      </label>
      <label className="field">
        說明
        <textarea rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </label>
      <label className="small">
        <input type="checkbox" checked={Boolean(d.startCondition)} onChange={(e) => setD({ ...d, startCondition: e.target.checked ? { type: "flag_equals", flag: "accepted", value: true } : undefined })} /> 條件成立時才開始（否則一開始就進行中）
      </label>
      {d.startCondition && <ConditionEditor project={project} value={d.startCondition} onChange={(startCondition) => setD({ ...d, startCondition })} />}
      <div className="small muted">目標（依序完成）</div>
      {d.objectives.map((o, i) => (
        <div key={i} className="event-page stack" style={{ gap: 6 }}>
          <div className="logic-row small">
            {i + 1}.
            <select value={o.type} onChange={(e) => setObj(i, { type: e.target.value as QuestObjective["type"], targetId: targetOptions(project, e.target.value as QuestObjective["type"])[0]?.id ?? "" })}>
              {Object.entries(OBJECTIVE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select value={o.targetId} onChange={(e) => setObj(i, { targetId: e.target.value })}>
              {targetOptions(project, o.type).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button className="btn small" disabled={d.objectives.length <= 1} onClick={() => setD({ ...d, objectives: d.objectives.filter((_, j) => j !== i) })}>
              移除
            </button>
          </div>
          <input type="text" value={o.description} placeholder="玩家看到的目標說明（寫出找誰／去哪／做什麼）" onChange={(e) => setObj(i, { description: e.target.value })} />
        </div>
      ))}
      <button
        className="btn small"
        onClick={() => setD({ ...d, objectives: [...d.objectives, { id: uniqueId("o", d.objectives.map((o) => o.id)), type: "talk_to_npc", targetId: project.npcs[0]?.id ?? "", description: "新目標" }] })}
      >
        ＋ 目標
      </button>
      <div className="small muted">完成獎勵</div>
      <EffectsEditor project={project} value={d.rewards ?? []} onChange={(rewards) => setD({ ...d, rewards: rewards.length ? rewards : undefined })} />
      <FormActions onOk={() => dispatch([{ op: "quest.upsert", quest: d }])} onDelete={() => dispatch([{ op: "quest.remove", id: quest.id }])} />
    </div>
  );
}

function ItemForm({ item, dispatch }: { item: ItemDefinition; dispatch: (ops: StudioOp[]) => void }) {
  const [d, setD] = useState(item);
  return (
    <div className="db-form stack">
      <span className="badge mono">{d.id}</span>
      <label className="field">
        名稱
        <input type="text" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </label>
      <label className="field">
        說明
        <textarea rows={2} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </label>
      <div className="small muted">圖示</div>
      <div className="sprite-picker">
        {icons.map((a) => (
          <button
            key={a.id}
            title={a.name}
            className={`sprite-option${d.iconAssetId === a.id ? " active" : ""}`}
            onClick={() => setD({ ...d, iconAssetId: a.id })}
            style={{ backgroundImage: `url(${a.src})`, backgroundPosition: `-${(a.frame! % 12) * 32}px -${Math.floor(a.frame! / 12) * 32}px`, backgroundSize: "384px auto" }}
          />
        ))}
      </div>
      <FormActions onOk={() => dispatch([{ op: "item.upsert", item: d }])} onDelete={() => dispatch([{ op: "item.remove", id: item.id }])} />
    </div>
  );
}

function EndingForm({ project, ending, dispatch }: { project: GameProject; ending: EndingDefinition; dispatch: (ops: StudioOp[]) => void }) {
  const [d, setD] = useState(ending);
  const epilogues = d.epilogues ?? [];
  return (
    <div className="db-form stack">
      <span className="badge mono">{d.id}</span>
      <label className="field">
        結局名稱
        <input type="text" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
      </label>
      <label className="field">
        結局文字
        <textarea rows={4} value={d.text} onChange={(e) => setD({ ...d, text: e.target.value })} />
      </label>
      <label className="field">
        結局音樂
        <select value={d.mood ?? "triumphant"} onChange={(e) => setD({ ...d, mood: e.target.value as EndingDefinition["mood"] })}>
          <option value="triumphant">圓滿</option>
          <option value="bittersweet">苦樂參半</option>
          <option value="somber">沉重</option>
          <option value="mysterious">懸疑</option>
        </select>
      </label>
      <div className="small muted">達成條件（狀態變化後依序檢查，第一個成立的就是結局）</div>
      <ConditionEditor project={project} value={d.condition} onChange={(condition) => setD({ ...d, condition })} />
      <div className="small muted">結局尾聲（條件成立時追加在結局文字後）</div>
      {epilogues.map((x, i) => (
        <div key={i} className="event-page stack" style={{ gap: 6 }}>
          <ConditionEditor project={project} value={x.condition} onChange={(condition) => setD({ ...d, epilogues: epilogues.map((y, j) => (j === i ? { ...y, condition } : y)) })} />
          <div className="row">
            <input type="text" value={x.text} onChange={(e) => setD({ ...d, epilogues: epilogues.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) })} />
            <button className="btn small" onClick={() => setD({ ...d, epilogues: epilogues.filter((_, j) => j !== i) })}>
              移除
            </button>
          </div>
        </div>
      ))}
      <button className="btn small" onClick={() => setD({ ...d, epilogues: [...epilogues, { condition: { type: "flag_equals", flag: "flag", value: true }, text: "尾聲文字" }] })}>
        ＋ 尾聲
      </button>
      <div className="small muted">目前條件：{describeCondition(project, d.condition)}</div>
      <FormActions onOk={() => dispatch([{ op: "ending.upsert", ending: { ...d, epilogues: epilogues.length ? epilogues : undefined } }])} onDelete={() => dispatch([{ op: "ending.remove", id: ending.id }])} />
    </div>
  );
}

function SystemForm({ project, dispatch }: { project: GameProject; dispatch: (ops: StudioOp[]) => void }) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [intro, setIntro] = useState(project.intro ?? "");
  const [genre, setGenre] = useState(project.genre);
  const [cover, setCover] = useState(project.cover ?? {});
  const [player, setPlayer] = useState({ name: project.player.name, description: project.player.description ?? "", spriteAssetId: project.player.spriteAssetId ?? "char_hero" });
  const coverChars = cover.characterAssetIds ?? [];
  return (
    <div className="db-form stack">
      <label className="field">
        遊戲名稱
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        簡介（遊戲庫卡片）
        <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className="field">
        開場訊息（空一行分成多則）
        <textarea rows={4} value={intro} onChange={(e) => setIntro(e.target.value)} />
      </label>
      <label className="field">
        類型
        <select value={genre} onChange={(e) => setGenre(e.target.value as GameProject["genre"])}>
          {Object.entries(GENRE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <h3>封面</h3>
      <div className="row small">
        背景地圖
        <select value={cover.sceneId ?? project.startSceneId} onChange={(e) => setCover({ ...cover, sceneId: e.target.value })}>
          {project.scenes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <label className="field">
        標語
        <input type="text" maxLength={60} value={cover.tagline ?? ""} onChange={(e) => setCover({ ...cover, tagline: e.target.value || undefined })} />
      </label>
      <div className="small muted">主視覺角色（最多 3 個，點選切換）</div>
      <div className="sprite-picker">
        {characters.map((a) => (
          <button
            key={a.id}
            title={a.name}
            className={`sprite-option${coverChars.includes(a.id) ? " active" : ""}`}
            onClick={() =>
              setCover({ ...cover, characterAssetIds: coverChars.includes(a.id) ? coverChars.filter((x) => x !== a.id) : [...coverChars, a.id].slice(-3) })
            }
            style={{ backgroundImage: `url(${a.src})`, backgroundPosition: `-${(a.frame! % 12) * 32}px -${Math.floor(a.frame! / 12) * 32}px`, backgroundSize: "384px auto" }}
          />
        ))}
      </div>
      <h3>主角</h3>
      <label className="field">
        名稱
        <input type="text" value={player.name} onChange={(e) => setPlayer({ ...player, name: e.target.value })} />
      </label>
      <label className="field">
        描述
        <textarea rows={2} value={player.description} onChange={(e) => setPlayer({ ...player, description: e.target.value })} />
      </label>
      <div className="sprite-picker">
        {characters.map((a) => (
          <button
            key={a.id}
            title={a.name}
            className={`sprite-option${player.spriteAssetId === a.id ? " active" : ""}`}
            onClick={() => setPlayer({ ...player, spriteAssetId: a.id })}
            style={{ backgroundImage: `url(${a.src})`, backgroundPosition: `-${(a.frame! % 12) * 32}px -${Math.floor(a.frame! / 12) * 32}px`, backgroundSize: "384px auto" }}
          />
        ))}
      </div>
      <div className="small muted">背景音樂請在地圖清單的地圖屬性中設定；可用情緒：{MUSIC_MOODS.join("、")}</div>
      <FormActions
        onOk={() =>
          dispatch([
            { op: "project.update", title, description, intro: intro || undefined, genre, cover },
            { op: "player.update", name: player.name, description: player.description || undefined, spriteAssetId: player.spriteAssetId },
          ])
        }
      />
      <div className="small muted">
        目前效果範例：{project.quests[0]?.rewards?.[0] ? describeEffect(project, project.quests[0].rewards[0]) : "（尚無任務獎勵）"}
      </div>
    </div>
  );
}
