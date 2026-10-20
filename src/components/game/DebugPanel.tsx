"use client";

import { useState } from "react";
import type { PlayerState } from "@/game/engine";
import type { GameProject } from "@/game/schema";

/**
 * F9 除錯面板（RPG Maker 測試遊玩的 F9）：只在後台測試遊玩出現。
 * 直接改開關、變數、物品、任務狀態、所在位置，或從某一章重新開始，用來測試某一段劇情而不必從頭玩。
 */
export default function DebugPanel({
  project,
  state,
  onChange,
  onStartChapter,
  onClose,
}: {
  project: GameProject;
  state: PlayerState;
  onChange: (next: PlayerState, label: string) => void;
  onStartChapter: (chapterId: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"switches" | "variables" | "items" | "quests" | "warp">("switches");
  const [filter, setFilter] = useState("");
  const match = (s: string) => !filter || s.toLowerCase().includes(filter.toLowerCase());
  const set = (patch: Partial<PlayerState>, label: string) => onChange({ ...state, ...patch }, label);

  return (
    <div className="rm-debug" data-testid="debug-panel" onKeyDown={(e) => e.stopPropagation()}>
      <div className="rm-debug-head">
        <b>🐞 除錯（F9）</b>
        <input placeholder="搜尋…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button onClick={onClose}>✕</button>
      </div>
      <div className="rm-debug-tabs">
        {(
          [
            ["switches", "開關"],
            ["variables", "變數"],
            ["items", "物品"],
            ["quests", "任務"],
            ["warp", "章節／位置"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="rm-debug-body">
        {tab === "switches" &&
          project.switches
            .filter((s) => match(s.id + s.name))
            .map((s) => (
              <label key={s.id} className="rm-debug-row">
                <input
                  type="checkbox"
                  checked={state.switches[s.id] === true}
                  onChange={(e) => set({ switches: { ...state.switches, [s.id]: e.target.checked } }, `開關「${s.name}」= ${e.target.checked ? "ON" : "OFF"}`)}
                />
                <span>{s.name}</span>
                <code>{s.id}</code>
              </label>
            ))}
        {tab === "variables" &&
          project.variables
            .filter((v) => match(v.id + v.name))
            .map((v) => (
              <label key={v.id} className="rm-debug-row">
                <input
                  type="number"
                  value={state.variables[v.id] ?? 0}
                  onChange={(e) => set({ variables: { ...state.variables, [v.id]: Number(e.target.value) || 0 } }, `變數「${v.name}」= ${e.target.value}`)}
                />
                <span>{v.name}</span>
                <code>{v.id}</code>
              </label>
            ))}
        {tab === "items" &&
          project.items
            .filter((i) => match(i.id + i.name))
            .map((i) => (
              <label key={i.id} className="rm-debug-row">
                <input
                  type="number"
                  min={0}
                  value={state.items[i.id] ?? 0}
                  onChange={(e) => {
                    const n = Math.max(0, Number(e.target.value) || 0);
                    const items = { ...state.items };
                    if (n === 0) delete items[i.id];
                    else items[i.id] = n;
                    set({ items }, `物品「${i.name}」×${n}`);
                  }}
                />
                <span>{i.name}</span>
                <code>{i.id}</code>
              </label>
            ))}
        {tab === "quests" &&
          project.quests
            .filter((q) => match(q.id + q.title))
            .map((q) => {
              const cur = state.quests[q.id] ?? { status: "inactive" as const, step: 0 };
              return (
                <div key={q.id} className="rm-debug-row">
                  <select value={cur.status} onChange={(e) => set({ quests: { ...state.quests, [q.id]: { ...cur, status: e.target.value as typeof cur.status } } }, `任務「${q.title}」→ ${e.target.value}`)}>
                    <option value="inactive">未開始</option>
                    <option value="active">進行中</option>
                    <option value="completed">完成</option>
                    <option value="failed">失敗</option>
                  </select>
                  <select value={cur.step} onChange={(e) => set({ quests: { ...state.quests, [q.id]: { ...cur, step: Number(e.target.value) } } }, `任務「${q.title}」第 ${Number(e.target.value) + 1} 步`)}>
                    {q.steps.map((st, i) => (
                      <option key={i} value={i}>
                        {i + 1}. {st.text.slice(0, 16)}
                      </option>
                    ))}
                  </select>
                  <span>{q.title}</span>
                </div>
              );
            })}
        {tab === "warp" && (
          <>
            <div className="rm-debug-note">從某一章開始：套用章節的「測試起點」狀態，重新開始</div>
            {project.chapters.length === 0 && <div className="rm-debug-note">這款遊戲還沒有設定章節。</div>}
            {project.chapters.map((c) => (
              <button key={c.id} className="rm-debug-row rm-debug-btn" onClick={() => onStartChapter(c.id)} disabled={!c.testStart}>
                ▶ {c.title}
                {!c.testStart && "（未設定測試起點）"}
              </button>
            ))}
            <div className="rm-debug-note" style={{ marginTop: 10 }}>
              瞬間移動（保留目前進度）
            </div>
            {project.maps.map((m) => (
              <button key={m.id} className="rm-debug-row rm-debug-btn" onClick={() => set({ mapId: m.id, x: -1, y: -1, interpreter: null, message: null, erased: [] }, `移動到「${m.name}」`)}>
                🗺 {m.name}
              </button>
            ))}
          </>
        )}
      </div>
      <div className="rm-debug-foot">
        目前：{project.maps.find((m) => m.id === state.mapId)?.name} ({state.x},{state.y})・{project.chapters.find((c) => c.id === state.chapterId)?.title ?? "未進入章節"}
      </div>
    </div>
  );
}
