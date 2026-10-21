"use client";

import { useState } from "react";
import { MUSIC_MOODS } from "@/game/assets";
import { branchList, type Branch, type CommandPath } from "@/game/commands";
import { describeCommand, describeCondition } from "@/game/describe";
import { DIRECTIONS, SELF_SWITCHES, type EventCommand, type GameProject } from "@/game/schema";
import {
  ChapterSelect,
  CommonEventSelect,
  ConditionEditor,
  defaultCondition,
  EndingSelect,
  ItemSelect,
  MapSelect,
  QuestSelect,
  SwitchSelect,
  VariableSelect,
} from "./LogicEditors";

/**
 * 事件的「執行內容」編輯器（RPG Maker 的指令清單）：
 * - 每一行是一個指令（◆），條件分支與顯示選項的內容會縮排顯示，最後一行的「◆」用來新增指令。
 * - 雙擊（或選取後按 Enter）編輯；在「◆」上雙擊新增；選取後可刪除、上下移動、複製貼上（Delete、Ctrl/⌘+C／V）。
 */

type Row =
  | { kind: "cmd"; key: string; depth: number; path: CommandPath; index: number; cmd: EventCommand }
  | { kind: "insert"; key: string; depth: number; path: CommandPath; index: number }
  | { kind: "label"; key: string; depth: number; text: string };

/** 指令的複製貼上（跨事件、跨事件頁共用） */
const clip: { cmd: EventCommand | null } = { cmd: null };
const copyCommand = (cmd: EventCommand) => {
  clip.cmd = structuredClone(cmd);
};
const pastedCommand = () => (clip.cmd ? structuredClone(clip.cmd) : null);

function rowsOf(list: EventCommand[], path: CommandPath, depth: number, out: Row[], p: GameProject) {
  const base = path.join(".");
  list.forEach((cmd, index) => {
    out.push({ kind: "cmd", key: `${base}/${index}`, depth, path, index, cmd });
    if (cmd.code === "if") {
      rowsOf(cmd.then, [...path, index, "then"], depth + 1, out, p);
      if (cmd.else) {
        out.push({ kind: "label", key: `${base}/${index}/else`, depth, text: "：除此之外" });
        rowsOf(cmd.else, [...path, index, "else"], depth + 1, out, p);
      }
      out.push({ kind: "label", key: `${base}/${index}/end`, depth, text: "：分支結束" });
    } else if (cmd.code === "choices") {
      cmd.options.forEach((o, i) => {
        out.push({ kind: "label", key: `${base}/${index}/o${i}`, depth, text: `：選擇「${o.text}」時${o.condition ? `［${describeCondition(p, o.condition)}］` : ""}` });
        rowsOf(o.commands, [...path, index, i], depth + 1, out, p);
      });
      out.push({ kind: "label", key: `${base}/${index}/end`, depth, text: "：分支結束" });
    } else if (cmd.code === "present") {
      cmd.options.forEach((o, i) => {
        out.push({ kind: "label", key: `${base}/${index}/o${i}`, depth, text: `：拿出［${p.items.find((it) => it.id === o.itemId)?.name ?? o.itemId}］時` });
        rowsOf(o.commands, [...path, index, i], depth + 1, out, p);
      });
      out.push({ kind: "label", key: `${base}/${index}/otherwise`, depth, text: "：拿出其他物品時" });
      rowsOf(cmd.otherwise, [...path, index, "otherwise"], depth + 1, out, p);
      out.push({ kind: "label", key: `${base}/${index}/cancel`, depth, text: "：什麼都不拿時" });
      rowsOf(cmd.cancel ?? [], [...path, index, "cancel"], depth + 1, out, p);
      out.push({ kind: "label", key: `${base}/${index}/end`, depth, text: "：分支結束" });
    }
  });
  out.push({ kind: "insert", key: `${base}/+`, depth, path, index: list.length });
}

/** 不可變更新：把 path 指到的巢狀指令列換成 fn 的結果 */
export function updateList(root: EventCommand[], path: CommandPath, fn: (list: EventCommand[]) => EventCommand[]): EventCommand[] {
  if (path.length === 0) return fn(root);
  const [index, branch, ...rest] = path as [number, Branch, ...CommandPath];
  return root.map((cmd, i) => {
    if (i !== index) return cmd;
    const sub = branchList(cmd, branch) ?? [];
    const next = updateList(sub, rest, fn);
    if (cmd.code === "if") return branch === "then" ? { ...cmd, then: next } : { ...cmd, else: next };
    if (cmd.code === "choices") return { ...cmd, options: cmd.options.map((o, j) => (j === branch ? { ...o, commands: next } : o)) };
    if (cmd.code === "present") {
      if (branch === "otherwise") return { ...cmd, otherwise: next };
      if (branch === "cancel") return { ...cmd, cancel: next };
      return { ...cmd, options: cmd.options.map((o, j) => (j === branch ? { ...o, commands: next } : o)) };
    }
    return cmd;
  });
}

const COLOR: Partial<Record<EventCommand["code"], string>> = {
  text: "cmd-text",
  choices: "cmd-flow",
  present: "cmd-flow",
  time: "cmd-state",
  if: "cmd-flow",
  label: "cmd-flow",
  jump: "cmd-flow",
  exit: "cmd-flow",
  switch: "cmd-state",
  selfSwitch: "cmd-state",
  variable: "cmd-state",
  item: "cmd-party",
  quest: "cmd-party",
  transfer: "cmd-move",
  ending: "cmd-end",
  chapter: "cmd-end",
  comment: "cmd-comment",
};

export function CommandList({ project, commands, onChange }: { project: GameProject; commands: EventCommand[]; onChange: (list: EventCommand[]) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: "new"; path: CommandPath; index: number } | { mode: "edit"; path: CommandPath; index: number; cmd: EventCommand } | null>(null);
  const rows: Row[] = [];
  rowsOf(commands, [], 0, rows, project);
  const current = rows.find((r) => r.key === selected);

  const insert = (path: CommandPath, index: number, cmd: EventCommand) => onChange(updateList(commands, path, (l) => [...l.slice(0, index), cmd, ...l.slice(index)]));
  const replace = (path: CommandPath, index: number, cmd: EventCommand) => onChange(updateList(commands, path, (l) => l.map((c, i) => (i === index ? cmd : c))));
  const remove = (path: CommandPath, index: number) => onChange(updateList(commands, path, (l) => l.filter((_, i) => i !== index)));
  const moveBy = (path: CommandPath, index: number, d: number) =>
    onChange(
      updateList(commands, path, (l) => {
        const j = index + d;
        if (j < 0 || j >= l.length) return l;
        const next = [...l];
        [next[index], next[j]] = [next[j], next[index]];
        return next;
      }),
    );

  const open = (r: Row | undefined) => {
    if (!r || r.kind === "label") return;
    if (r.kind === "insert") setDialog({ mode: "new", path: r.path, index: r.index });
    else setDialog({ mode: "edit", path: r.path, index: r.index, cmd: r.cmd });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!current || current.kind === "label" || dialog) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open(current);
    } else if ((e.key === "Delete" || e.key === "Backspace") && current.kind === "cmd") {
      e.preventDefault();
      remove(current.path, current.index);
    } else if (mod && e.key.toLowerCase() === "c" && current.kind === "cmd") {
      copyCommand(current.cmd);
    } else if (mod && e.key.toLowerCase() === "v" && clip.cmd) {
      e.preventDefault();
      insert(current.path, current.index, pastedCommand()!);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = rows.indexOf(current) + (e.key === "ArrowDown" ? 1 : -1);
      if (rows[i]) setSelected(rows[i].key);
    }
  };

  return (
    <div className="cmd-editor">
      <div className="cmd-toolbar">
        <button className="btn small" onClick={() => current && current.kind !== "label" && setDialog({ mode: "new", path: current.path, index: current.index })} disabled={!current || current.kind === "label"} title="在選取的位置插入指令（Enter／雙擊「◆」）">
          ＋ 插入指令
        </button>
        <button className="btn small" onClick={() => open(current)} disabled={current?.kind !== "cmd"}>
          編輯
        </button>
        <button className="btn small" onClick={() => current?.kind === "cmd" && moveBy(current.path, current.index, -1)} disabled={current?.kind !== "cmd"}>
          ↑
        </button>
        <button className="btn small" onClick={() => current?.kind === "cmd" && moveBy(current.path, current.index, 1)} disabled={current?.kind !== "cmd"}>
          ↓
        </button>
        <button className="btn small" onClick={() => current?.kind === "cmd" && copyCommand(current.cmd)} disabled={current?.kind !== "cmd"}>
          複製
        </button>
        <button className="btn small" onClick={() => {
            const cmd = pastedCommand();
            if (current && current.kind !== "label" && cmd) insert(current.path, current.index, cmd);
          }} disabled={!current || current.kind === "label"}>
          貼上
        </button>
        <button className="btn small danger" onClick={() => current?.kind === "cmd" && remove(current.path, current.index)} disabled={current?.kind !== "cmd"}>
          刪除
        </button>
      </div>
      <div className="cmd-list" tabIndex={0} onKeyDown={onKey} data-testid="command-list">
        {rows.map((r) => (
          <div
            key={r.key}
            className={`cmd-row ${r.kind}${r.kind === "cmd" ? ` ${COLOR[r.cmd.code] ?? ""}` : ""}${selected === r.key ? " selected" : ""}`}
            style={{ paddingLeft: 8 + r.depth * 18 }}
            onClick={() => setSelected(r.key)}
            onDoubleClick={() => open(r)}
            data-code={r.kind === "cmd" ? r.cmd.code : undefined}
          >
            {r.kind === "cmd" ? `◆${describeCommand(project, r.cmd)}` : r.kind === "insert" ? "◆" : r.text}
          </div>
        ))}
      </div>
      {dialog && (
        <CommandDialog
          project={project}
          initial={dialog.mode === "edit" ? dialog.cmd : null}
          onCancel={() => setDialog(null)}
          onOk={(cmd) => {
            if (dialog.mode === "edit") replace(dialog.path, dialog.index, cmd);
            else insert(dialog.path, dialog.index, cmd);
            setDialog(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- 指令視窗 ----------

const CATEGORIES: Array<{ title: string; items: Array<[EventCommand["code"], string, string]> }> = [
  {
    title: "訊息",
    items: [
      ["text", "顯示文字", "顯示對話或旁白；選角色會帶出名字、頭像與講話聲"],
      ["choices", "顯示選項", "讓玩家選擇；每個選項有自己的執行內容"],
      ["present", "出示物品", "打開道具欄讓玩家拿出一樣東西：證據對質、送禮、用鑰匙開門"],
      ["comment", "註解", "不會執行，給自己和 AI 看的說明"],
    ],
  },
  {
    title: "流程控制",
    items: [
      ["if", "條件分支", "依開關、變數、物品、任務等條件執行不同內容"],
      ["common", "共用事件", "呼叫資料庫裡的共用事件"],
      ["label", "標籤", "跳轉的目的地（只能放在最外層）"],
      ["jump", "跳轉到標籤", "回到或跳到同一個事件頁的標籤"],
      ["exit", "中斷事件處理", "立刻結束這個事件"],
      ["wait", "等待", "停頓一下（毫秒）"],
    ],
  },
  {
    title: "遊戲進度",
    items: [
      ["switch", "開關操作", "記錄劇情進度與玩家的選擇（ON／OFF）"],
      ["selfSwitch", "獨立開關操作", "只屬於這個事件的開關（例如寶箱已打開）"],
      ["variable", "變數操作", "數值：好感度、次數、金錢…"],
      ["item", "增減物品", "給予或拿走物品"],
      ["quest", "任務", "開始、推進、完成任務日誌"],
      ["time", "時間經過", "經過幾個時段，或設定成第幾天的哪個時段（要先在系統設定時段）"],
    ],
  },
  {
    title: "地圖與系統",
    items: [
      ["transfer", "場所移動", "把玩家移到另一張地圖的指定位置"],
      ["erase", "暫時消除事件", "離開地圖再回來前，事件不會出現"],
      ["music", "播放背景音樂", "改變背景音樂（或停止）"],
      ["chapter", "章節", "顯示章節標題卡，進入新的章節"],
      ["ending", "結局", "播放結局畫面，遊戲結束"],
    ],
  },
];

function defaultCommand(code: EventCommand["code"], p: GameProject): EventCommand {
  switch (code) {
    case "text":
      return { code, text: "", ...(p.actors[1] ? { actorId: p.actors[1].id } : {}) };
    case "choices":
      return { code, options: [{ text: "是", commands: [] }, { text: "否", commands: [] }] };
    case "present":
      return { code, options: p.items[0] ? [{ itemId: p.items[0].id, commands: [] }] : [], otherwise: [{ code: "text", text: "……這個不對。" }] };
    case "time":
      return { code, advance: 1 };
    case "if":
      return { code, condition: defaultCondition("switch", p), then: [] };
    case "switch":
      return { code, ids: [p.switches[0]?.id ?? ""], value: true };
    case "selfSwitch":
      return { code, key: "A", value: true };
    case "variable":
      return { code, id: p.variables[0]?.id ?? "", op: "add", value: 1 };
    case "item":
      return { code, itemId: p.items[0]?.id ?? "", delta: 1 };
    case "quest":
      return { code, questId: p.quests[0]?.id ?? "", action: "start" };
    case "transfer":
      return { code, mapId: p.maps[0].id, x: 1, y: 1 };
    case "ending":
      return { code, endingId: p.endings[0]?.id ?? "" };
    case "chapter":
      return { code, chapterId: p.chapters[0]?.id ?? "" };
    case "common":
      return { code, id: p.commonEvents[0]?.id ?? "" };
    case "label":
    case "jump":
      return { code, name: "" };
    case "wait":
      return { code, ms: 500 };
    case "music":
      return { code, mood: "tense" };
    case "comment":
      return { code, text: "" };
    case "erase":
    case "exit":
      return { code };
  }
}

const MUSIC_LABELS: Record<string, string> = { peaceful: "平和", lively: "熱鬧", adventure: "冒險", mysterious: "神秘", tense: "緊張", melancholy: "感傷" };

function CommandDialog({ project, initial, onOk, onCancel }: { project: GameProject; initial: EventCommand | null; onOk: (cmd: EventCommand) => void; onCancel: () => void }) {
  const [cmd, setCmd] = useState<EventCommand | null>(initial);
  const title = cmd ? CATEGORIES.flatMap((c) => c.items).find(([code]) => code === cmd.code)?.[1] : "插入指令";
  return (
    <div className="db-overlay cmd-overlay" onKeyDown={(e) => e.stopPropagation()}>
      <div className="cmd-dialog" data-testid="command-dialog">
        <div className="cmd-dialog-title">{title}</div>
        {!cmd ? (
          <div className="cmd-picker">
            {CATEGORIES.map((cat) => (
              <div key={cat.title} className="cmd-cat">
                <div className="section-title">{cat.title}</div>
                {cat.items.map(([code, label, hint]) => (
                  <button key={code} className="cmd-pick" onClick={() => setCmd(defaultCommand(code, project))} title={hint} data-code={code}>
                    {label}
                    <span className="small muted">{hint}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="cmd-form stack">
            <CommandForm project={project} cmd={cmd} onChange={setCmd} />
          </div>
        )}
        <div className="row cmd-dialog-foot">
          {cmd && !initial && (
            <button className="btn small" onClick={() => setCmd(null)}>
              ← 換一個指令
            </button>
          )}
          <span className="grow" />
          <button className="btn small" onClick={onCancel}>
            取消
          </button>
          <button className="btn small primary" disabled={!cmd} onClick={() => cmd && onOk(cmd)} data-testid="command-ok">
            確定
          </button>
        </div>
      </div>
    </div>
  );
}

function CommandForm({ project, cmd, onChange }: { project: GameProject; cmd: EventCommand; onChange: (c: EventCommand) => void }) {
  switch (cmd.code) {
    case "text":
      return (
        <>
          <label className="field">
            說話的角色
            <select value={cmd.actorId ?? ""} onChange={(e) => onChange({ ...cmd, actorId: e.target.value || undefined })}>
              <option value="">（無：旁白或路人）</option>
              {project.actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            名字欄（不填就用角色名稱）
            <input type="text" value={cmd.speaker ?? ""} maxLength={60} onChange={(e) => onChange({ ...cmd, speaker: e.target.value || undefined })} />
          </label>
          <label className="field">
            文字（每則 2～3 句最好讀）
            <textarea rows={4} value={cmd.text} autoFocus onChange={(e) => onChange({ ...cmd, text: e.target.value })} data-testid="text-input" />
          </label>
        </>
      );
    case "choices":
      return (
        <>
          <div className="small muted">緊接在「顯示文字」後面時，選項會和文字一起出現。每個選項的執行內容在清單裡編輯。</div>
          {cmd.options.map((o, i) => (
            <div key={i} className="event-page stack" style={{ gap: 6 }}>
              <div className="logic-row">
                <span>選項 {i + 1}</span>
                <input type="text" value={o.text} onChange={(e) => onChange({ ...cmd, options: cmd.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                <button className="btn small" disabled={cmd.options.length <= 1} onClick={() => onChange({ ...cmd, options: cmd.options.filter((_, j) => j !== i) })}>
                  移除
                </button>
              </div>
              <label className="small">
                <input
                  type="checkbox"
                  checked={Boolean(o.condition)}
                  onChange={(e) => onChange({ ...cmd, options: cmd.options.map((x, j) => (j === i ? { ...x, condition: e.target.checked ? defaultCondition("switch", project) : undefined } : x)) })}
                />{" "}
                只在條件成立時出現
              </label>
              {o.condition && (
                <ConditionEditor project={project} value={o.condition} onChange={(c) => onChange({ ...cmd, options: cmd.options.map((x, j) => (j === i ? { ...x, condition: c } : x)) })} />
              )}
            </div>
          ))}
          <button className="btn small" disabled={cmd.options.length >= 8} onClick={() => onChange({ ...cmd, options: [...cmd.options, { text: "", commands: [] }] })}>
            ＋ 選項
          </button>
        </>
      );
    case "present":
      return (
        <>
          <div className="small muted">打開道具欄讓玩家拿出一樣東西。緊接在「顯示文字」後面時，會和文字一起出現（例如「你有什麼證據？」）。每一項的反應在清單裡編輯；拿出沒列在這裡的物品，會執行「拿出其他物品時」。</div>
          {cmd.options.map((o, i) => (
            <div key={i} className="logic-row">
              <span>物品 {i + 1}</span>
              <ItemSelect project={project} value={o.itemId} onChange={(itemId) => onChange({ ...cmd, options: cmd.options.map((x, j) => (j === i ? { ...x, itemId } : x)) })} />
              <button className="btn small" onClick={() => onChange({ ...cmd, options: cmd.options.filter((_, j) => j !== i) })}>
                移除
              </button>
            </div>
          ))}
          <button className="btn small" disabled={cmd.options.length >= 12 || project.items.length === 0} onClick={() => onChange({ ...cmd, options: [...cmd.options, { itemId: project.items[0]?.id ?? "", commands: [] }] })}>
            ＋ 物品
          </button>
        </>
      );
    case "time": {
      const periods = project.system.clock?.periods;
      if (!periods) return <div className="notice">要先在「資料庫 → 系統」設定時段（例如 早上、中午、傍晚、晚上），才能使用時間指令。</div>;
      return (
        <>
          <label className="field">
            經過幾個時段（過了「{periods[periods.length - 1]}」就到下一天）
            <input type="number" min={0} max={50} value={cmd.advance ?? 0} onChange={(e) => onChange({ ...cmd, advance: Number(e.target.value) || undefined })} />
          </label>
          <div className="small muted">或直接設定成：</div>
          <div className="logic-row">
            <label className="small">
              第
              <input type="number" min={1} style={{ width: 64 }} value={cmd.day ?? ""} placeholder="不變" onChange={(e) => onChange({ ...cmd, day: e.target.value ? Math.max(1, Number(e.target.value)) : undefined })} />
              天
            </label>
            <select value={cmd.period ?? ""} onChange={(e) => onChange({ ...cmd, period: e.target.value === "" ? undefined : Number(e.target.value) })}>
              <option value="">時段不變</option>
              {periods.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </>
      );
    }
    case "if":
      return (
        <>
          <ConditionEditor project={project} value={cmd.condition} onChange={(condition) => onChange({ ...cmd, condition })} />
          <label className="small">
            <input type="checkbox" checked={Boolean(cmd.else)} onChange={(e) => onChange({ ...cmd, else: e.target.checked ? (cmd.else ?? []) : undefined })} /> 條件不成立時也要執行內容（建立「除此之外」分支）
          </label>
        </>
      );
    case "switch":
      return (
        <>
          {cmd.ids.map((id, i) => (
            <div key={i} className="logic-row">
              <SwitchSelect project={project} value={id} onChange={(v) => onChange({ ...cmd, ids: cmd.ids.map((x, j) => (j === i ? v : x)) })} />
              <button className="btn small" disabled={cmd.ids.length <= 1} onClick={() => onChange({ ...cmd, ids: cmd.ids.filter((_, j) => j !== i) })}>
                移除
              </button>
            </div>
          ))}
          <button className="btn small" onClick={() => onChange({ ...cmd, ids: [...cmd.ids, project.switches[0]?.id ?? ""] })}>
            ＋ 同時操作另一個開關
          </button>
          <OnOff value={cmd.value} onChange={(value) => onChange({ ...cmd, value })} />
        </>
      );
    case "selfSwitch":
      return (
        <div className="logic-row">
          <select value={cmd.key} onChange={(e) => onChange({ ...cmd, key: e.target.value as (typeof SELF_SWITCHES)[number] })}>
            {SELF_SWITCHES.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <OnOff value={cmd.value} onChange={(value) => onChange({ ...cmd, value })} />
        </div>
      );
    case "variable":
      return (
        <div className="logic-row">
          <VariableSelect project={project} value={cmd.id} onChange={(id) => onChange({ ...cmd, id })} />
          <select value={cmd.op} onChange={(e) => onChange({ ...cmd, op: e.target.value as "set" | "add" | "sub" })}>
            <option value="set">代入（=）</option>
            <option value="add">加（+=）</option>
            <option value="sub">減（-=）</option>
          </select>
          <input type="number" value={cmd.value} onChange={(e) => onChange({ ...cmd, value: Number(e.target.value) || 0 })} />
        </div>
      );
    case "item":
      return (
        <div className="logic-row">
          <ItemSelect project={project} value={cmd.itemId} onChange={(itemId) => onChange({ ...cmd, itemId })} />
          <select value={cmd.delta > 0 ? "add" : "sub"} onChange={(e) => onChange({ ...cmd, delta: Math.abs(cmd.delta) * (e.target.value === "add" ? 1 : -1) })}>
            <option value="add">增加</option>
            <option value="sub">減少</option>
          </select>
          <input type="number" min={1} value={Math.abs(cmd.delta)} onChange={(e) => onChange({ ...cmd, delta: Math.max(1, Number(e.target.value) || 1) * Math.sign(cmd.delta || 1) })} />
        </div>
      );
    case "quest": {
      const quest = project.quests.find((q) => q.id === cmd.questId);
      return (
        <div className="logic-row">
          <QuestSelect project={project} value={cmd.questId} onChange={(questId) => onChange({ ...cmd, questId })} />
          <select value={cmd.action} onChange={(e) => onChange({ ...cmd, action: e.target.value as "start" | "step" | "complete" | "fail", step: e.target.value === "step" ? (cmd.step ?? 1) : undefined })}>
            <option value="start">開始</option>
            <option value="step">前進到步驟</option>
            <option value="complete">完成</option>
            <option value="fail">失敗</option>
          </select>
          {cmd.action === "step" && quest && (
            <select value={cmd.step ?? 0} onChange={(e) => onChange({ ...cmd, step: Number(e.target.value) })}>
              {quest.steps.map((st, i) => (
                <option key={i} value={i}>
                  第 {i + 1} 步：{st.text.slice(0, 16)}
                </option>
              ))}
            </select>
          )}
        </div>
      );
    }
    case "transfer":
      return (
        <div className="logic-row">
          <MapSelect project={project} value={cmd.mapId} onChange={(mapId) => onChange({ ...cmd, mapId })} />
          <span>X</span>
          <input type="number" min={0} value={cmd.x} onChange={(e) => onChange({ ...cmd, x: Math.max(0, Number(e.target.value) || 0) })} />
          <span>Y</span>
          <input type="number" min={0} value={cmd.y} onChange={(e) => onChange({ ...cmd, y: Math.max(0, Number(e.target.value) || 0) })} />
          <select value={cmd.direction ?? ""} onChange={(e) => onChange({ ...cmd, direction: (e.target.value || undefined) as (typeof DIRECTIONS)[number] | undefined })}>
            <option value="">方向不變</option>
            <option value="up">朝上</option>
            <option value="down">朝下</option>
            <option value="left">朝左</option>
            <option value="right">朝右</option>
          </select>
        </div>
      );
    case "ending":
      return <EndingSelect project={project} value={cmd.endingId} onChange={(endingId) => onChange({ ...cmd, endingId })} />;
    case "chapter":
      return <ChapterSelect project={project} value={cmd.chapterId} onChange={(chapterId) => onChange({ ...cmd, chapterId })} />;
    case "common":
      return <CommonEventSelect project={project} value={cmd.id} onChange={(id) => onChange({ ...cmd, id })} />;
    case "label":
    case "jump":
      return (
        <label className="field">
          標籤名稱
          <input type="text" value={cmd.name} maxLength={64} autoFocus onChange={(e) => onChange({ ...cmd, name: e.target.value })} />
        </label>
      );
    case "wait":
      return (
        <label className="field">
          毫秒
          <input type="number" min={0} max={10000} value={cmd.ms} onChange={(e) => onChange({ ...cmd, ms: Math.min(10000, Math.max(0, Number(e.target.value) || 0)) })} />
        </label>
      );
    case "music":
      return (
        <select value={cmd.mood ?? ""} onChange={(e) => onChange({ ...cmd, mood: (e.target.value || null) as (typeof MUSIC_MOODS)[number] | null })}>
          <option value="">停止音樂</option>
          {MUSIC_MOODS.map((m) => (
            <option key={m} value={m}>
              {MUSIC_LABELS[m]}
            </option>
          ))}
        </select>
      );
    case "comment":
      return <textarea rows={4} value={cmd.text} autoFocus onChange={(e) => onChange({ ...cmd, text: e.target.value })} />;
    case "erase":
      return <div className="small muted">這個事件會消失，直到玩家離開地圖再回來。要永久消失，請改用獨立開關＋沒有圖像的事件頁。</div>;
    case "exit":
      return <div className="small muted">執行到這裡時，立刻結束這個事件。</div>;
  }
}

function OnOff({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="logic-row">
      <label>
        <input type="radio" checked={value} onChange={() => onChange(true)} /> ON
      </label>
      <label>
        <input type="radio" checked={!value} onChange={() => onChange(false)} /> OFF
      </label>
    </div>
  );
}

