"use client";

import { useState } from "react";
import IssueList from "@/components/IssueList";
import { ASSET_CATALOG, LICENSES } from "@/game/assets";
import { allConditions, walkCondition, walkProject } from "@/game/commands";
import { describeCondition } from "@/game/describe";
import {
  ENDING_MOOD_IDS,
  GENRE_LABELS,
  QUEST_STATUSES,
  type AchievementDefinition,
  type Actor,
  type ChapterDefinition,
  type CommonEvent,
  type EndingDefinition,
  type GameProject,
  type ItemDefinition,
  type QuestDefinition,
} from "@/game/schema";
import type { ValidationReport } from "@/game/validate";
import { getAudio } from "@/lib/audio";
import type { StudioOp } from "@/studio/ops";
import { CommandList } from "./CommandEditor";
import { allIds } from "./EventEditor";
import { AssetPicker, AssetThumb, ConditionEditor, defaultCondition, ItemSelect, MapSelect, QUEST_STATUS_LABEL, QuestSelect, SwitchSelect } from "./LogicEditors";

/**
 * 資料庫視窗（RPG Maker 的資料庫）：角色、物品、任務、結局、章節、共用事件、開關、變數、系統、素材、驗證。
 * 每一頁左邊是清單、右邊是表單；按「確定」才送出操作（可以復原）。
 */

export type DbTab = "actors" | "items" | "quests" | "endings" | "achievements" | "chapters" | "commons" | "switches" | "variables" | "system" | "assets" | "validation";
const TABS: Array<[DbTab, string]> = [
  ["actors", "角色"],
  ["items", "物品"],
  ["quests", "任務"],
  ["endings", "結局"],
  ["achievements", "成就"],
  ["chapters", "章節"],
  ["commons", "共用事件"],
  ["switches", "開關"],
  ["variables", "變數"],
  ["system", "系統"],
  ["assets", "素材"],
  ["validation", "驗證"],
];
const characters = ASSET_CATALOG.filter((a) => a.kind === "character");
const MOOD_LABEL: Record<(typeof ENDING_MOOD_IDS)[number], string> = { triumphant: "圓滿", bittersweet: "苦樂參半", somber: "沉重", mysterious: "懸疑" };

function uniqueId(prefix: string, taken: string[]) {
  for (let i = 1; ; i++) if (!taken.includes(`${prefix}_${i}`)) return `${prefix}_${i}`;
}

/** 開關／變數在哪些地方被使用（設定 + 讀取次數） */
function usage(project: GameProject) {
  const sw = new Map<string, number>();
  const vars = new Map<string, number>();
  const bump = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  walkProject(project, (c) => {
    if (c.code === "switch") c.ids.forEach((id) => bump(sw, id));
    if (c.code === "variable") bump(vars, c.id);
  });
  allConditions(project).forEach((c) =>
    walkCondition(c, (a) => {
      if (a.type === "switch") bump(sw, a.id);
      if (a.type === "variable") bump(vars, a.id);
    }),
  );
  return { sw, vars };
}

export default function Database({
  project,
  report,
  tab,
  focusId,
  dispatch,
  onTab,
  onClose,
  onTestChapter,
}: {
  project: GameProject;
  report: ValidationReport;
  tab: DbTab;
  focusId: string | null;
  dispatch: (ops: StudioOp[]) => void;
  onTab: (tab: DbTab, focusId?: string | null) => void;
  onClose: () => void;
  onTestChapter: (chapterId: string) => void;
}) {
  const ids = allIds(project);
  const list = (rows: Array<{ id: string; label: string }>, onAdd: () => void) => (
    <div className="db-list">
      <button className="btn small" onClick={onAdd} data-testid="db-add">
        ＋ 新增
      </button>
      {rows.map((r, i) => (
        <button key={r.id} className={`db-row${(focusId ?? rows[0]?.id) === r.id ? " active" : ""}`} onClick={() => onTab(tab, r.id)}>
          <span className="mono small">
            {String(i + 1).padStart(3, "0")}：{r.id}
          </span>
          <span>{r.label}</span>
        </button>
      ))}
    </div>
  );
  const pick = <T extends { id: string }>(items: T[]) => items.find((x) => x.id === focusId) ?? items[0];
  const empty = (text: string) => <div className="db-form small muted">{text}</div>;

  let body: React.ReactNode = null;
  if (tab === "actors") {
    const a = pick(project.actors);
    body = (
      <>
        {list(
          project.actors.map((x) => ({ id: x.id, label: `${x.name}${x.id === project.system.playerActorId ? "（主角）" : ""}` })),
          () => {
            const id = uniqueId("actor", ids);
            dispatch([{ op: "actor.upsert", actor: { id, name: "新角色", spriteAssetId: "char_villager" } }]);
            onTab("actors", id);
          },
        )}
        {a && <ActorForm key={a.id} project={project} actor={a} dispatch={dispatch} />}
      </>
    );
  } else if (tab === "items") {
    const it = pick(project.items);
    body = (
      <>
        {list(
          project.items.map((x) => ({ id: x.id, label: x.name })),
          () => {
            const id = uniqueId("item", ids);
            dispatch([{ op: "item.upsert", item: { id, name: "新物品", description: "", iconAssetId: "icon_coin" } }]);
            onTab("items", id);
          },
        )}
        {it ? <ItemForm key={it.id} item={it} dispatch={dispatch} /> : empty("還沒有物品。按「＋ 新增」建立，例如鑰匙、信件、證物。")}
      </>
    );
  } else if (tab === "quests") {
    const q = pick(project.quests);
    body = (
      <>
        {list(
          project.quests.map((x) => ({ id: x.id, label: x.title })),
          () => {
            const id = uniqueId("quest", ids);
            dispatch([{ op: "quest.upsert", quest: { id, title: "新任務", description: "", steps: [{ text: "第一步要做的事" }] } }]);
            onTab("quests", id);
          },
        )}
        {q ? <QuestForm key={q.id} quest={q} dispatch={dispatch} /> : empty("還沒有任務。任務日誌會顯示在玩家選單；在事件中用「任務」指令開始與推進。")}
      </>
    );
  } else if (tab === "endings") {
    const e = pick(project.endings);
    body = (
      <>
        {list(
          project.endings.map((x) => ({ id: x.id, label: x.title })),
          () => {
            const id = uniqueId("ending", ids);
            dispatch([{ op: "ending.upsert", ending: { id, title: "新結局", text: "結局文字" } }]);
            onTab("endings", id);
          },
        )}
        {e && <EndingForm key={e.id} project={project} ending={e} dispatch={dispatch} />}
      </>
    );
  } else if (tab === "achievements") {
    const a = pick(project.achievements ?? []);
    body = (
      <>
        {list(
          (project.achievements ?? []).map((x) => ({ id: x.id, label: x.title })),
          () => {
            const id = uniqueId("achv", ids);
            dispatch([{ op: "achievement.upsert", achievement: { id, title: "新成就", description: "解鎖後顯示的說明", hint: "還沒解鎖時的提示", condition: defaultCondition("switch", project) } }]);
            onTab("achievements", id);
          },
        )}
        {a ? (
          <AchievementForm key={a.id} project={project} achievement={a} dispatch={dispatch} />
        ) : (
          empty("成就讓玩家知道「還有別的分支、別的發現」：條件成立時解鎖，跨存檔記錄在玩家的裝置上。每個結局會自動產生成就，不必另外寫。建議每章 2～4 個，獎勵探索與走另一條路。")
        )}
      </>
    );
  } else if (tab === "chapters") {
    const c = pick(project.chapters);
    body = (
      <>
        {list(
          project.chapters.map((x) => ({ id: x.id, label: x.title })),
          () => {
            const id = uniqueId("ch", ids);
            const s = project.system.start;
            dispatch([{ op: "chapter.upsert", chapter: { id, title: `第 ${project.chapters.length + 1} 章`, testStart: { mapId: s.mapId, x: s.x, y: s.y } } }]);
            onTab("chapters", id);
          },
        )}
        {c ? <ChapterForm key={c.id} project={project} chapter={c} dispatch={dispatch} onTest={onTestChapter} /> : empty("還沒有章節。1～2 小時的遊戲建議分成 4～6 章；每章可以設定「測試起點」，直接從這一章開始測試。")}
      </>
    );
  } else if (tab === "commons") {
    const c = pick(project.commonEvents);
    body = (
      <>
        {list(
          project.commonEvents.map((x) => ({ id: x.id, label: x.name })),
          () => {
            const id = uniqueId("ce", ids);
            dispatch([{ op: "commonEvent.upsert", commonEvent: { id, name: "新共用事件", trigger: "call", commands: [] } }]);
            onTab("commons", id);
          },
        )}
        {c ? <CommonForm key={c.id} project={project} common={c} dispatch={dispatch} /> : empty("共用事件是可以重複使用的指令組合，例如「睡覺回復」「霧的描述」。在事件中用「共用事件」指令呼叫。")}
      </>
    );
  } else if (tab === "switches" || tab === "variables") {
    const isSw = tab === "switches";
    const rows = isSw ? project.switches : project.variables;
    const used = usage(project)[isSw ? "sw" : "vars"];
    body = (
      <div className="db-form stack">
        <p className="small muted">
          {isSw ? "開關記錄 ON／OFF（劇情進度、玩家的選擇）。" : "變數記錄數字（好感度、次數）。"}
          在指令或條件中輸入新的 ID 時會自動加到這裡；名稱可以改成好懂的中文。
        </p>
        <table className="version-table">
          <thead>
            <tr>
              <th>#</th>
              <th>ID</th>
              <th>名稱</th>
              <th>使用次數</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td className="small muted">{String(i + 1).padStart(4, "0")}</td>
                <td className="mono small">{r.id}</td>
                <td>
                  <input
                    type="text"
                    defaultValue={r.name}
                    key={`${r.id}-${r.name}`}
                    onBlur={(e) => e.target.value && e.target.value !== r.name && dispatch([isSw ? { op: "switch.upsert", switch: { id: r.id, name: e.target.value } } : { op: "variable.upsert", variable: { id: r.id, name: e.target.value } }])}
                  />
                </td>
                <td className="small">{used.get(r.id) ?? 0}</td>
                <td>
                  <button className="btn small" disabled={(used.get(r.id) ?? 0) > 0} title={(used.get(r.id) ?? 0) > 0 ? "還有地方在使用" : ""} onClick={() => dispatch([isSw ? { op: "switch.remove", id: r.id } : { op: "variable.remove", id: r.id }])}>
                    刪除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          className="btn small"
          onClick={() => {
            const id = window.prompt("新的 ID（英數字與底線）")?.replace(/[^A-Za-z0-9_-]/g, "_");
            if (id) dispatch([isSw ? { op: "switch.upsert", switch: { id, name: id } } : { op: "variable.upsert", variable: { id, name: id } }]);
          }}
        >
          ＋ 新增
        </button>
      </div>
    );
  } else if (tab === "system") {
    body = <SystemForm project={project} dispatch={dispatch} />;
  } else if (tab === "assets") {
    body = (
      <div className="db-form stack">
        <p className="small muted">遊戲只引用素材 ID；素材全部來自內建素材庫（CC0），授權資訊由素材庫產生。</p>
        <div className="asset-picker">
          {ASSET_CATALOG.filter((a) => a.kind !== "tileset").map((a) => (
            <span key={a.id} className="asset-swatch" title={`${a.name}（${a.id}）`}>
              <AssetThumb src={a.src} frame={a.frame ?? 0} />
            </span>
          ))}
        </div>
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
            <button key={key} className={tab === key ? "active" : ""} onClick={() => onTab(key, null)} data-testid={`db-tab-${key}`}>
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
      <button className="btn small primary" onClick={onOk} data-testid="db-ok">
        確定
      </button>
      {onDelete && (
        <button className="btn small danger" onClick={() => window.confirm("確定要刪除嗎？") && onDelete()}>
          刪除
        </button>
      )}
    </div>
  );
}

function ActorForm({ project, actor, dispatch }: { project: GameProject; actor: Actor; dispatch: (ops: StudioOp[]) => void }) {
  const [a, setA] = useState(actor);
  const voice = a.voice ?? { pitch: "mid", speed: "normal", timbre: "soft" };
  const isPlayer = actor.id === project.system.playerActorId;
  return (
    <div className="db-form stack">
      <label className="field">
        名稱
        <input type="text" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} data-testid="actor-name" />
      </label>
      <label className="field">
        角色設定（想要什麼、秘密、說話風格；不會顯示在遊戲中）
        <textarea rows={3} value={a.profile ?? ""} onChange={(e) => setA({ ...a, profile: e.target.value || undefined })} />
      </label>
      <div className="small muted">角色圖（也是對話的頭像）</div>
      <AssetPicker kind="character" value={a.spriteAssetId} onChange={(id) => setA({ ...a, spriteAssetId: id })} />
      <div className="small muted">講話聲（逐字顯示時的合成音）</div>
      <div className="logic-row">
        <select value={voice.pitch} onChange={(e) => setA({ ...a, voice: { ...voice, pitch: e.target.value as typeof voice.pitch } })}>
          <option value="low">低音</option>
          <option value="mid">中音</option>
          <option value="high">高音</option>
        </select>
        <select value={voice.speed} onChange={(e) => setA({ ...a, voice: { ...voice, speed: e.target.value as typeof voice.speed } })}>
          <option value="slow">慢</option>
          <option value="normal">普通</option>
          <option value="fast">快</option>
        </select>
        <select value={voice.timbre} onChange={(e) => setA({ ...a, voice: { ...voice, timbre: e.target.value as typeof voice.timbre } })}>
          <option value="soft">柔和</option>
          <option value="bright">明亮</option>
          <option value="buzzy">粗啞</option>
        </select>
        <button
          className="btn small"
          onClick={() => {
            getAudio().unlock();
            for (let i = 0; i < 6; i++) window.setTimeout(() => getAudio().blip(voice), i * 70);
          }}
        >
          ▶ 試聽
        </button>
      </div>
      <FormActions onOk={() => dispatch([{ op: "actor.upsert", actor: a }])} onDelete={isPlayer ? undefined : () => dispatch([{ op: "actor.remove", id: actor.id }])} />
    </div>
  );
}

function ItemForm({ item, dispatch }: { item: ItemDefinition; dispatch: (ops: StudioOp[]) => void }) {
  const [it, setIt] = useState(item);
  return (
    <div className="db-form stack">
      <label className="field">
        名稱
        <input type="text" value={it.name} onChange={(e) => setIt({ ...it, name: e.target.value })} />
      </label>
      <label className="field">
        說明（玩家在道具選單看到的文字）
        <textarea rows={2} value={it.description} onChange={(e) => setIt({ ...it, description: e.target.value })} />
      </label>
      <div className="small muted">圖示</div>
      <AssetPicker kind="icon" value={it.iconAssetId} onChange={(id) => setIt({ ...it, iconAssetId: id })} />
      <FormActions onOk={() => dispatch([{ op: "item.upsert", item: it }])} onDelete={() => dispatch([{ op: "item.remove", id: item.id }])} />
    </div>
  );
}

function QuestForm({ quest, dispatch }: { quest: QuestDefinition; dispatch: (ops: StudioOp[]) => void }) {
  const [q, setQ] = useState(quest);
  return (
    <div className="db-form stack">
      <label className="field">
        任務名稱
        <input type="text" value={q.title} onChange={(e) => setQ({ ...q, title: e.target.value })} />
      </label>
      <label className="field">
        說明
        <textarea rows={2} value={q.description} onChange={(e) => setQ({ ...q, description: e.target.value })} />
      </label>
      <div className="small muted">步驟（任務日誌依序顯示；寫清楚「找誰／去哪／做什麼」）。在事件中用「任務 → 前進到步驟」推進。</div>
      {q.steps.map((st, i) => (
        <div key={i} className="logic-row">
          <span className="small muted">第 {i + 1} 步</span>
          <input type="text" value={st.text} onChange={(e) => setQ({ ...q, steps: q.steps.map((x, j) => (j === i ? { text: e.target.value } : x)) })} />
          <button className="btn small" disabled={q.steps.length <= 1} onClick={() => setQ({ ...q, steps: q.steps.filter((_, j) => j !== i) })}>
            移除
          </button>
        </div>
      ))}
      <button className="btn small" onClick={() => setQ({ ...q, steps: [...q.steps, { text: "" }] })}>
        ＋ 步驟
      </button>
      <FormActions onOk={() => dispatch([{ op: "quest.upsert", quest: { ...q, steps: q.steps.filter((s) => s.text.trim()) } }])} onDelete={() => dispatch([{ op: "quest.remove", id: quest.id }])} />
    </div>
  );
}

function EndingForm({ project, ending, dispatch }: { project: GameProject; ending: EndingDefinition; dispatch: (ops: StudioOp[]) => void }) {
  const [d, setD] = useState(ending);
  const epilogues = d.epilogues ?? [];
  const where: string[] = [];
  walkProject(project, (c, ctx) => c.code === "ending" && c.endingId === ending.id && where.push(ctx.label));
  return (
    <div className="db-form stack">
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
          {ENDING_MOOD_IDS.map((m) => (
            <option key={m} value={m}>
              {MOOD_LABEL[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        未完待續：下一章的章節 ID（連載用；這一章推出後，停在這個結局的存檔可以接著玩）
        <input type="text" value={d.nextChapterId ?? ""} placeholder="例如 ch2（留空＝真正的結局）" onChange={(e) => setD({ ...d, nextChapterId: e.target.value.replace(/[^A-Za-z0-9_-]/g, "") || undefined })} />
      </label>
      <div className={`small ${where.length ? "muted" : "err-text"}`}>
        觸發位置：{where.length ? where.join("、") : "還沒有任何事件使用「結局」指令觸發這個結局"}
      </div>
      <div className="small muted">結局尾聲（條件成立時追加在結局文字後，用來回應玩家一路上的選擇）</div>
      {epilogues.map((x, i) => (
        <div key={i} className="event-page stack" style={{ gap: 6 }}>
          <ConditionEditor project={project} value={x.condition} onChange={(condition) => setD({ ...d, epilogues: epilogues.map((y, j) => (j === i ? { ...y, condition } : y)) })} />
          <div className="row">
            <input type="text" value={x.text} onChange={(e) => setD({ ...d, epilogues: epilogues.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)) })} />
            <button className="btn small" onClick={() => setD({ ...d, epilogues: epilogues.filter((_, j) => j !== i) })}>
              移除
            </button>
          </div>
          <div className="small muted">{describeCondition(project, x.condition)}</div>
        </div>
      ))}
      <button className="btn small" onClick={() => setD({ ...d, epilogues: [...epilogues, { condition: defaultCondition("switch", project), text: "尾聲文字" }] })}>
        ＋ 尾聲
      </button>
      <FormActions onOk={() => dispatch([{ op: "ending.upsert", ending: { ...d, epilogues: epilogues.length ? epilogues : undefined } }])} onDelete={() => dispatch([{ op: "ending.remove", id: ending.id }])} />
    </div>
  );
}

function AchievementForm({ project, achievement, dispatch }: { project: GameProject; achievement: AchievementDefinition; dispatch: (ops: StudioOp[]) => void }) {
  const [d, setD] = useState(achievement);
  return (
    <div className="db-form stack">
      <label className="field">
        成就名稱
        <input type="text" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} />
      </label>
      <label className="field">
        解鎖後的說明
        <input type="text" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
      </label>
      <label className="field">
        還沒解鎖時的提示（模糊地暗示怎麼解鎖；留空顯示「？？？」）
        <input type="text" value={d.hint ?? ""} onChange={(e) => setD({ ...d, hint: e.target.value || undefined })} />
      </label>
      <label className="small">
        <input type="checkbox" checked={Boolean(d.hidden)} onChange={(e) => setD({ ...d, hidden: e.target.checked || undefined })} /> 隱藏成就（解鎖前連名稱都不顯示）
      </label>
      <div className="small muted">解鎖條件</div>
      <ConditionEditor project={project} value={d.condition} onChange={(condition) => setD({ ...d, condition })} />
      <div className="small muted">{describeCondition(project, d.condition)}</div>
      <FormActions onOk={() => dispatch([{ op: "achievement.upsert", achievement: d }])} onDelete={() => dispatch([{ op: "achievement.remove", id: achievement.id }])} />
    </div>
  );
}

function ChapterForm({ project, chapter, dispatch, onTest }: { project: GameProject; chapter: ChapterDefinition; dispatch: (ops: StudioOp[]) => void; onTest: (id: string) => void }) {
  const [c, setC] = useState(chapter);
  const t = c.testStart ?? { mapId: project.system.start.mapId, x: project.system.start.x, y: project.system.start.y };
  const setT = (patch: Partial<NonNullable<ChapterDefinition["testStart"]>>) => setC({ ...c, testStart: { ...t, ...patch } });
  const index = project.chapters.findIndex((x) => x.id === chapter.id);
  return (
    <div className="db-form stack">
      <label className="field">
        章節名稱（顯示在章節標題卡）
        <input type="text" value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} />
      </label>
      <label className="field">
        一句話摘要（顯示在標題卡下方）
        <input type="text" maxLength={300} value={c.summary ?? ""} onChange={(e) => setC({ ...c, summary: e.target.value || undefined })} />
      </label>
      <div className="small muted">在事件中用「章節」指令進入這一章（會顯示標題卡）。</div>
      <h3 style={{ margin: "8px 0 0" }}>測試起點</h3>
      <div className="small muted">「從這一章開始測試」時使用的狀態：照主線玩到這一章開頭時，玩家應該在哪裡、打開了哪些開關、拿著哪些物品、任務進行到哪。</div>
      <div className="logic-row">
        <MapSelect project={project} value={t.mapId} onChange={(mapId) => setT({ mapId })} />
        <span>X</span>
        <input type="number" min={0} value={t.x} onChange={(e) => setT({ x: Number(e.target.value) || 0 })} />
        <span>Y</span>
        <input type="number" min={0} value={t.y} onChange={(e) => setT({ y: Number(e.target.value) || 0 })} />
      </div>
      <div className="small">已打開的開關</div>
      {(t.switches ?? []).map((id, i) => (
        <div key={i} className="logic-row">
          <SwitchSelect project={project} value={id} onChange={(v) => setT({ switches: t.switches!.map((x, j) => (j === i ? v : x)) })} />
          <button className="btn small" onClick={() => setT({ switches: t.switches!.filter((_, j) => j !== i) })}>
            移除
          </button>
        </div>
      ))}
      <button className="btn small" onClick={() => setT({ switches: [...(t.switches ?? []), project.switches[0]?.id ?? ""] })}>
        ＋ 開關
      </button>
      <div className="small">持有物品</div>
      {Object.entries(t.items ?? {}).map(([id, n]) => (
        <div key={id} className="logic-row">
          <ItemSelect
            project={project}
            value={id}
            onChange={(v) => {
              const items = { ...t.items };
              delete items[id];
              setT({ items: { ...items, [v]: n } });
            }}
          />
          <input type="number" min={1} value={n} onChange={(e) => setT({ items: { ...t.items, [id]: Math.max(1, Number(e.target.value) || 1) } })} />
          <button
            className="btn small"
            onClick={() => {
              const items = { ...t.items };
              delete items[id];
              setT({ items });
            }}
          >
            移除
          </button>
        </div>
      ))}
      <button className="btn small" disabled={project.items.length === 0} onClick={() => setT({ items: { ...t.items, [project.items.find((i) => !t.items?.[i.id])?.id ?? project.items[0].id]: 1 } })}>
        ＋ 物品
      </button>
      <div className="small">任務狀態</div>
      {Object.entries(t.quests ?? {}).map(([id, q]) => {
        const quest = project.quests.find((x) => x.id === id);
        return (
          <div key={id} className="logic-row">
            <QuestSelect
              project={project}
              value={id}
              onChange={(v) => {
                const quests = { ...t.quests };
                delete quests[id];
                setT({ quests: { ...quests, [v]: q } });
              }}
            />
            <select value={q.status} onChange={(e) => setT({ quests: { ...t.quests, [id]: { ...q, status: e.target.value as (typeof QUEST_STATUSES)[number] } } })}>
              {QUEST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {QUEST_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select value={q.step} onChange={(e) => setT({ quests: { ...t.quests, [id]: { ...q, step: Number(e.target.value) } } })}>
              {(quest?.steps ?? []).map((st, i) => (
                <option key={i} value={i}>
                  第 {i + 1} 步：{st.text.slice(0, 12)}
                </option>
              ))}
            </select>
            <button
              className="btn small"
              onClick={() => {
                const quests = { ...t.quests };
                delete quests[id];
                setT({ quests });
              }}
            >
              移除
            </button>
          </div>
        );
      })}
      <button className="btn small" disabled={project.quests.length === 0} onClick={() => setT({ quests: { ...t.quests, [project.quests[0].id]: { status: "active", step: 0 } } })}>
        ＋ 任務
      </button>
      <div className="row">
        <FormActions onOk={() => dispatch([{ op: "chapter.upsert", chapter: c }])} onDelete={() => dispatch([{ op: "chapter.remove", id: chapter.id }])} />
        <span className="grow" />
        <button className="btn small" disabled={index <= 0} onClick={() => dispatch([{ op: "chapter.remove", id: chapter.id }, { op: "chapter.upsert", chapter: c, before: project.chapters[index - 1].id }])}>
          ↑ 往前
        </button>
        <button className="btn small primary" onClick={() => onTest(chapter.id)} data-testid="test-chapter">
          ▶ 從這一章開始測試
        </button>
      </div>
    </div>
  );
}

function CommonForm({ project, common, dispatch }: { project: GameProject; common: CommonEvent; dispatch: (ops: StudioOp[]) => void }) {
  const [c, setC] = useState(common);
  return (
    <div className="db-form stack">
      <div className="logic-row">
        <label className="field grow">
          名稱
          <input type="text" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        </label>
        <label className="field">
          觸發
          <select value={c.trigger} onChange={(e) => setC({ ...c, trigger: e.target.value as CommonEvent["trigger"], switchId: e.target.value === "autorun" ? (c.switchId ?? project.switches[0]?.id) : undefined })}>
            <option value="call">被呼叫時</option>
            <option value="autorun">開關 ON 時自動執行</option>
          </select>
        </label>
        {c.trigger === "autorun" && (
          <label className="field">
            開關
            <SwitchSelect project={project} value={c.switchId ?? ""} onChange={(switchId) => setC({ ...c, switchId })} />
          </label>
        )}
      </div>
      <div className="section-title">執行內容</div>
      <CommandList project={project} commands={c.commands} onChange={(commands) => setC({ ...c, commands })} />
      <FormActions onOk={() => dispatch([{ op: "commonEvent.upsert", commonEvent: c }])} onDelete={() => dispatch([{ op: "commonEvent.remove", id: common.id }])} />
    </div>
  );
}

function SystemForm({ project, dispatch }: { project: GameProject; dispatch: (ops: StudioOp[]) => void }) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [intro, setIntro] = useState(project.intro ?? "");
  const [genre, setGenre] = useState(project.genre);
  const [cover, setCover] = useState(project.cover ?? {});
  const [playerActorId, setPlayerActorId] = useState(project.system.playerActorId);
  const [initialItems, setInitialItems] = useState(project.system.initialItems);
  const [release, setRelease] = useState(project.release ?? { status: "complete" as const });
  const coverChars = cover.characterAssetIds ?? [];
  const start = project.system.start;
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
        開場訊息（新遊戲時顯示；空一行分成多則）
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
      <h3>推出方式</h3>
      <div className="logic-row">
        <select value={release.status} onChange={(e) => setRelease({ ...release, status: e.target.value as "ongoing" | "complete" })} data-testid="release-status">
          <option value="ongoing">連載中（一章一章推出）</option>
          <option value="complete">已完結</option>
        </select>
        <span className="small">預計共</span>
        <input type="number" min={1} max={20} value={release.plannedChapters ?? ""} onChange={(e) => setRelease({ ...release, plannedChapters: Number(e.target.value) || undefined })} style={{ width: 70 }} />
        <span className="small">章</span>
      </div>
      <div className="small muted">連載中：至少推出 1 章就能發布，每章通過章節審查即可；章末用「未完待續」結局（設定下一章 ID），新章推出後玩家的存檔可以直接接著玩。</div>
      <h3>主角與起點</h3>
      <div className="logic-row">
        <span>主角</span>
        <select value={playerActorId} onChange={(e) => setPlayerActorId(e.target.value)}>
          {project.actors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="small muted">
          起點：{project.maps.find((m) => m.id === start.mapId)?.name} ({start.x},{start.y})（在地圖上選一格 →「設為玩家起點」）
        </span>
      </div>
      <div className="small">初始物品</div>
      {initialItems.map((it, i) => (
        <div key={i} className="logic-row">
          <ItemSelect project={project} value={it.itemId} onChange={(itemId) => setInitialItems(initialItems.map((x, j) => (j === i ? { ...x, itemId } : x)))} />
          <input type="number" min={1} value={it.count} onChange={(e) => setInitialItems(initialItems.map((x, j) => (j === i ? { ...x, count: Math.max(1, Number(e.target.value) || 1) } : x)))} />
          <button className="btn small" onClick={() => setInitialItems(initialItems.filter((_, j) => j !== i))}>
            移除
          </button>
        </div>
      ))}
      <button className="btn small" disabled={project.items.length === 0} onClick={() => setInitialItems([...initialItems, { itemId: project.items[0].id, count: 1 }])}>
        ＋ 初始物品
      </button>
      <h3>封面</h3>
      <div className="logic-row">
        <span>背景地圖</span>
        <MapSelect project={project} value={cover.mapId ?? start.mapId} onChange={(mapId) => setCover({ ...cover, mapId })} />
      </div>
      <label className="field">
        標語
        <input type="text" maxLength={60} value={cover.tagline ?? ""} onChange={(e) => setCover({ ...cover, tagline: e.target.value || undefined })} />
      </label>
      <div className="small muted">主視覺角色（最多 3 個，點選切換）</div>
      <div className="asset-picker">
        {characters.map((a) => (
          <button
            key={a.id}
            title={a.name}
            className={`asset-swatch${coverChars.includes(a.id) ? " active" : ""}`}
            onClick={() => setCover({ ...cover, characterAssetIds: coverChars.includes(a.id) ? coverChars.filter((x) => x !== a.id) : [...coverChars, a.id].slice(-3) })}
          >
            <AssetThumb src={a.src} frame={a.frame ?? 0} />
          </button>
        ))}
      </div>
      <FormActions
        onOk={() =>
          dispatch([
            { op: "project.update", title, description, intro: intro || undefined, genre, cover, release },
            { op: "system.update", playerActorId, initialItems },
          ])
        }
      />
    </div>
  );
}
