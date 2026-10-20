"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MUSIC_MOODS, TERRAIN } from "@/game/assets";
import { describePageConditions, TRIGGER_LABEL } from "@/game/describe";
import type { GameProject, MapDefinition, MapEvent } from "@/game/schema";
import { downloadJson } from "@/game/storage";
import { ApiError, studioApi } from "@/lib/studioApi";
import { broadcastProject } from "@/lib/studioChannel";
import { applyOps, describeOp, type StudioOp } from "@/studio/ops";
import Database, { type DbTab } from "./Database";
import EventEditor, { emptyPage, QUICK_EVENTS, quickEvent, uniqueEventId } from "./EventEditor";
import MapCanvas, { TilePalette, type MapMode } from "./MapCanvas";

/**
 * RPG Maker 式 Studio 編輯器。
 * 版面：上方工具列｜左側圖塊＋地圖樹｜中間地圖畫布｜右側選取格的事件；事件編輯與資料庫另開視窗。
 * 所有編輯都轉成 Studio 操作 API（src/studio/ops.ts），與 AI 使用同一套操作。
 * 快捷鍵：Ctrl/⌘+Z 復原、Ctrl/⌘+Shift+Z 重做、Ctrl/⌘+S 儲存、F9 資料庫、F5 測試遊玩、Esc 關閉視窗。
 * 專案存在雲端：有修改時每 20 秒自動儲存；每 8 秒檢查雲端版本，AI 透過 API Token 的修改會即時出現。
 * 每次修改都會廣播給已開啟的測試遊玩視窗：測試視窗保留玩家進度、直接套用修改，不必重玩。
 */

const AUTOSAVE_MS = 20_000;
const POLL_MS = 8_000;
const TOUR_KEY = "rpg:studio-tour-v2";
const TOUR = [
  { title: "歡迎使用 Studio", text: "這是照 RPG Maker 設計的編輯器：地圖、事件、資料庫三個部分。工具列可以切換「🖌 地圖」與「❗ 事件」模式，也能開啟「📚 資料庫」與「▶ 測試遊玩」。" },
  { title: "🖌 地圖模式", text: "從左側「圖塊」選一種地形，在畫布上按住拖曳繪製；✕ 代表不可通行。左下是地圖樹，可以建立上下層的地圖（例如村莊 → 民宅）。" },
  { title: "❗ 事件模式", text: "遊戲裡的一切都是事件：人物、門、寶箱、劇情。雙擊格子開啟「事件編輯」，或在右側用「快速事件建立」。每個事件可以有多頁，依開關等條件切換內容。" },
  { title: "📚 資料庫", text: "角色、物品、任務、結局、章節、共用事件、開關與變數都在資料庫（F9）。章節可以設定「測試起點」，直接從那一章開始測試。" },
  { title: "▶ 測試遊玩", text: "可以從頭、從某一章或從選取的位置開始測試。測試時按 F9 能直接改開關與變數；編輯器的修改會即時套用到測試視窗，不用重玩。" },
];

const HISTORY_LIMIT = 100;
const MUSIC_LABELS: Record<string, string> = { peaceful: "平和", lively: "熱鬧", adventure: "冒險", mysterious: "神秘", tense: "緊張", melancholy: "感傷" };

/** 地圖樹：依 parentId 排成縮排清單 */
function mapTree(maps: MapDefinition[]) {
  const out: Array<{ map: MapDefinition; depth: number }> = [];
  const visit = (parent: string | undefined, depth: number) => {
    for (const m of maps.filter((x) => (x.parentId ?? undefined) === parent || (!parent && x.parentId && !maps.some((p) => p.id === x.parentId)))) {
      if (out.some((o) => o.map.id === m.id)) continue;
      out.push({ map: m, depth });
      visit(m.id, depth + 1);
    }
  };
  visit(undefined, 0);
  return out;
}

export default function StudioApp({ projectId, initialDb }: { projectId: string; initialDb?: DbTab | null }) {
  const [project, setProject] = useState<GameProject | null>(null);
  const [notFound, setNotFound] = useState(false);
  // 復原／重做的歷史放在 ref，state 只記筆數（觸發重繪）
  const historyRef = useRef<{ past: Array<{ project: GameProject; label: string }>; future: Array<{ project: GameProject; label: string }> }>({ past: [], future: [] });
  const [counts, setCounts] = useState({ past: 0, future: 0 });
  const [dirty, setDirty] = useState(false);
  const [mapId, setMapId] = useState<string>("");
  const [mode, setMode] = useState<MapMode>("map");
  const [tool, setTool] = useState<"pen" | "fill">("pen");
  const [brush, setBrush] = useState(".");
  const [zoom, setZoom] = useState(32);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<Map<string, string>>(new Map());
  const [db, setDb] = useState<{ tab: DbTab; focusId: string | null } | null>(null);
  const [editing, setEditing] = useState<{ event: MapEvent; isNew: boolean } | null>(null);
  const [log, setLog] = useState<Array<{ ok: boolean; text: string }>>([]);
  const projectRef = useRef<GameProject | null>(null);
  const baseVersionRef = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const pendingLabels = useRef<string[]>([]);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [conflict, setConflict] = useState<{ version: number; label: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tour, setTour] = useState<number | null>(null);

  const markDirty = (v: boolean) => {
    dirtyRef.current = v;
    setDirty(v);
  };

  const loadRemote = useCallback(
    async (message?: string) => {
      try {
        const r = await studioApi.getProject(projectId);
        projectRef.current = r.project;
        baseVersionRef.current = r.version;
        setBaseVersion(r.version);
        setProject(r.project);
        setMapId((s) => (r.project.maps.some((x) => x.id === s) ? s : r.project.system.start.mapId));
        historyRef.current = { past: [], future: [] };
        setCounts({ past: 0, future: 0 });
        markDirty(false);
        setConflict(null);
        if (message) setToast(message);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void loadRemote();
    if (initialDb) setDb({ tab: initialDb, focusId: null });
    try {
      if (!window.localStorage.getItem(TOUR_KEY)) requestAnimationFrame(() => setTour(0));
    } catch {
      // 無法記住導覽狀態時略過
    }
  }, [loadRemote, initialDb]);

  // 每次修改都廣播給測試遊玩視窗（不用等儲存）
  useEffect(() => {
    if (!project) return;
    const t = window.setTimeout(() => broadcastProject(projectId, project), 400);
    return () => window.clearTimeout(t);
  }, [project, projectId]);

  const report = useMemo(() => (project ? applyOps(project, []).report : null), [project]);

  /** 套用操作（人與 AI 共用的唯一修改入口） */
  const dispatch = useCallback((ops: StudioOp[]) => {
    const current = projectRef.current;
    if (!current || ops.length === 0) return;
    const result = applyOps(current, ops);
    const okCount = result.results.filter((r) => r.ok).length;
    setLog((l) => [...result.results.map((r) => ({ ok: r.ok, text: r.message })), ...l].slice(0, 40));
    if (okCount === 0) return;
    const h = historyRef.current;
    h.past = [...h.past, { project: current, label: ops.map(describeOp).join("、") }].slice(-HISTORY_LIMIT);
    h.future = [];
    setCounts({ past: h.past.length, future: 0 });
    projectRef.current = result.project;
    setProject(result.project);
    pendingLabels.current.push(ops.map(describeOp).join("、"));
    markDirty(true);
  }, []);

  const undo = useCallback(() => {
    const h = historyRef.current;
    const last = h.past.pop();
    if (!last || !projectRef.current) return;
    h.future.unshift({ project: projectRef.current, label: last.label });
    projectRef.current = last.project;
    setProject(last.project);
    setCounts({ past: h.past.length, future: h.future.length });
    pendingLabels.current.push(`復原：${last.label}`);
    markDirty(true);
    setLog((l) => [{ ok: true, text: `復原：${last.label}` }, ...l].slice(0, 40));
  }, []);

  const redo = useCallback(() => {
    const h = historyRef.current;
    const next = h.future.shift();
    if (!next || !projectRef.current) return;
    h.past.push({ project: projectRef.current, label: next.label });
    projectRef.current = next.project;
    setProject(next.project);
    setCounts({ past: h.past.length, future: h.future.length });
    pendingLabels.current.push(`重做：${next.label}`);
    markDirty(true);
    setLog((l) => [{ ok: true, text: `重做：${next.label}` }, ...l].slice(0, 40));
  }, []);

  /** 儲存到雲端（帶版本號，若別人或 AI 已修改會回報衝突）；overwrite=true 只用於衝突提示中的「以我的版本覆蓋」 */
  const save = useCallback(
    async (overwrite = false) => {
      const p = projectRef.current;
      if (!p || savingRef.current) return false;
      if (!dirtyRef.current && !overwrite) return true;
      savingRef.current = true;
      const labels = pendingLabels.current.splice(0);
      const label = labels.length ? `${labels.slice(0, 3).join("、")}${labels.length > 3 ? ` 等 ${labels.length} 項` : ""}` : "儲存";
      try {
        const r = await studioApi.saveProject(projectId, p, overwrite ? undefined : baseVersionRef.current, label, applyOps(p, []).report?.isValid ?? false);
        baseVersionRef.current = r.version;
        setBaseVersion(r.version);
        if (projectRef.current === p) markDirty(false);
        setConflict(null);
        setLog((l) => [{ ok: true, text: `已儲存為第 ${r.version} 版` }, ...l].slice(0, 40));
        return true;
      } catch (e) {
        pendingLabels.current.unshift(...labels);
        if (e instanceof ApiError && e.status === 409) setConflict({ version: Number(e.data.currentVersion ?? 0), label: "其他人或 AI 已修改專案" });
        setLog((l) => [{ ok: false, text: `無法儲存：${(e as Error).message}` }, ...l].slice(0, 40));
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [projectId],
  );

  // 自動儲存與雲端版本輪詢（AI 透過 API Token 的修改會即時出現）
  useEffect(() => {
    const autosave = window.setInterval(() => {
      if (dirtyRef.current) void save();
    }, AUTOSAVE_MS);
    const poll = window.setInterval(async () => {
      if (savingRef.current || baseVersionRef.current === undefined) return;
      const r = await studioApi.versions(projectId).catch(() => null);
      const latest = r?.versions[0];
      if (!latest || latest.version <= baseVersionRef.current) return;
      if (dirtyRef.current) setConflict({ version: latest.version, label: `${latest.actor}：${latest.label}` });
      else void loadRemote(`${latest.actor.includes("API Token") ? "🤖" : "👤"} ${latest.actor} 更新了專案（第 ${latest.version} 版）：${latest.label}`);
    }, POLL_MS);
    return () => {
      window.clearInterval(autosave);
      window.clearInterval(poll);
    };
  }, [save, loadRemote, projectId]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  /** 測試遊玩：先存檔，再開新分頁；query 可指定章節或位置 */
  const playtest = useCallback(
    async (query = "") => {
      if (await save()) window.open(`/studio/play/?id=${encodeURIComponent(projectId)}${query}`, "rpg-studio-play");
    },
    [save, projectId],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (!typing && mod && e.key.toLowerCase() === "z" && !editing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === "F9") {
        e.preventDefault();
        setDb((d) => (d ? null : { tab: "actors", focusId: null }));
      } else if (e.key === "F5") {
        e.preventDefault();
        void playtest();
      } else if (e.key === "Escape" && !editing) setDb(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo, playtest, editing]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (notFound) {
    return (
      <div className="container">
        <div className="notice err">找不到專案「{projectId}」，或你沒有權限開啟。</div>
        <p>
          <Link href="/studio/">回到 Studio 首頁</Link>
        </p>
      </div>
    );
  }
  if (!project || !report) return <div className="container muted">載入中…</div>;
  const map = project.maps.find((m) => m.id === mapId) ?? project.maps[0];
  const cellEvents = selected ? map.events.filter((e) => e.x === selected.x && e.y === selected.y) : [];

  const paint = (x: number, y: number) => {
    if (tool === "fill") {
      dispatch([{ op: "map.fill", mapId: map.id, x, y, ch: brush }]);
      return;
    }
    setPreview((m) => {
      if (m.get(`${x},${y}`) === brush) return m;
      const next = new Map(m);
      next.set(`${x},${y}`, brush);
      return next;
    });
  };
  const paintEnd = () => {
    if (preview.size > 0) {
      dispatch([{ op: "map.paint", mapId: map.id, cells: [...preview].map(([k, ch]) => ({ x: Number(k.split(",")[0]), y: Number(k.split(",")[1]), ch })) }]);
    }
    setPreview(new Map());
  };

  const addMap = (parentId?: string) => {
    const name = window.prompt(parentId ? "子地圖名稱（例如：民宅內部）" : "新地圖名稱", "新地圖");
    if (!name) return;
    const size = window.prompt("寬×高（例如 20x15）", "20x15") ?? "20x15";
    const [w, h] = size.split(/[x×*]/).map((n) => Number.parseInt(n, 10));
    let i = 1;
    while (project.maps.some((s) => s.id === `map_${i}`)) i++;
    dispatch([{ op: "map.add", id: `map_${i}`, name, width: Math.min(64, Math.max(5, w || 20)), height: Math.min(64, Math.max(5, h || 15)), ...(parentId ? { parentId } : {}) }]);
    setMapId(`map_${i}`);
  };

  const openEvent = (x: number, y: number) => {
    const existing = map.events.find((e) => e.x === x && e.y === y);
    setSelected({ x, y });
    setEditing(existing ? { event: existing, isNew: false } : { event: { id: uniqueEventId(map), name: `事件 ${map.events.length + 1}`, x, y, pages: [emptyPage()] }, isNew: true });
  };

  const testMenu = (
    <select
      className="btn small"
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (v === "here" && selected) void playtest(`&map=${map.id}&x=${selected.x}&y=${selected.y}`);
        else if (v.startsWith("ch:")) void playtest(`&chapter=${encodeURIComponent(v.slice(3))}`);
        e.target.value = "";
      }}
      title="從某一章或選取的位置開始測試"
      data-testid="play-from"
    >
      <option value="">從…開始 ▾</option>
      {project.chapters.map((c) => (
        <option key={c.id} value={`ch:${c.id}`} disabled={!c.testStart}>
          {c.title}
        </option>
      ))}
      <option value="here" disabled={!selected}>
        從選取的位置（{selected ? `${selected.x},${selected.y}` : "先點地圖"}）
      </option>
    </select>
  );

  return (
    <div className="studio-app">
      <div className="studio-toolbar">
        <Link href={`/studio/project/?id=${projectId}`} className="btn small" title="回到專案總覽">
          ←
        </Link>
        <strong className="studio-title">{project.title}</strong>
        <span className={`badge ${dirty ? "warn" : "ok"}`} title="有修改時每 20 秒自動儲存到雲端" data-testid="save-state">
          {dirty ? "未儲存" : `已儲存・v${baseVersion ?? "?"}`}
        </span>
        <div className="tool-group">
          <button className="btn small" onClick={() => void save()} title="儲存到雲端（Ctrl/⌘+S）" data-testid="studio-save">
            💾 儲存
          </button>
          <button className="btn small" onClick={undo} disabled={counts.past === 0} title="復原（Ctrl/⌘+Z）" data-testid="studio-undo">
            ↶
          </button>
          <button className="btn small" onClick={redo} disabled={counts.future === 0} title="重做（Ctrl/⌘+Shift+Z）">
            ↷
          </button>
        </div>
        <div className="tool-group" role="radiogroup" aria-label="編輯模式">
          <button className={`btn small${mode === "map" ? " primary" : ""}`} onClick={() => setMode("map")} data-testid="mode-map">
            🖌 地圖
          </button>
          <button className={`btn small${mode === "event" ? " primary" : ""}`} onClick={() => setMode("event")} data-testid="mode-event">
            ❗ 事件
          </button>
        </div>
        {mode === "map" && (
          <div className="tool-group">
            <button className={`btn small${tool === "pen" ? " primary" : ""}`} onClick={() => setTool("pen")}>
              畫筆
            </button>
            <button className={`btn small${tool === "fill" ? " primary" : ""}`} onClick={() => setTool("fill")}>
              油漆桶
            </button>
          </div>
        )}
        <div className="tool-group">
          <button className="btn small" onClick={() => setZoom((z) => Math.max(16, z - 8))}>
            －
          </button>
          <span className="small">{Math.round((zoom / 32) * 100)}%</span>
          <button className="btn small" onClick={() => setZoom((z) => Math.min(56, z + 8))}>
            ＋
          </button>
        </div>
        <button className="btn small" onClick={() => setDb({ tab: "actors", focusId: null })} title="資料庫（F9）" data-testid="open-database">
          📚 資料庫
        </button>
        <span className="grow" />
        <button className={`badge ${report.isValid ? "ok" : "err"}`} onClick={() => setDb({ tab: "validation", focusId: null })} data-testid="validation-badge">
          {report.isValid ? `✓ 驗證通過${report.warnings.length ? `（${report.warnings.length} 警告）` : ""}` : `✗ ${report.errors.length} 個錯誤`}
        </button>
        <button className="btn small" onClick={() => downloadJson(`${project.id}.json`, JSON.stringify(project, null, 2))}>
          匯出
        </button>
        <button className="btn small" onClick={() => setTour(0)} title="重新顯示導覽">
          ？導覽
        </button>
        <div className="tool-group">
          <button className="btn small primary" onClick={() => void playtest()} title="從頭測試遊玩（F5）" data-testid="studio-play">
            ▶ 測試遊玩
          </button>
          {testMenu}
        </div>
      </div>

      <div className="studio-main">
        <aside className="studio-left">
          {mode === "map" ? (
            <div className="panel-section">
              <div className="section-title">圖塊</div>
              <TilePalette value={brush} onChange={setBrush} />
              <div className="small muted" style={{ marginTop: 6 }}>
                目前：{TERRAIN[brush]?.name}（{TERRAIN[brush]?.walkable ? "可通行" : "不可通行"}）
              </div>
            </div>
          ) : (
            <div className="panel-section small muted">
              事件模式：點格子選取，雙擊開啟「事件編輯」（空格會新增事件）；按住事件拖曳可以移動位置。
              <div style={{ marginTop: 8 }}>圖例：角色圖＝人物・<span style={{ color: "#ff7ad9" }}>！</span>確定鍵事件・◇ 接觸事件・▶ 自動執行・⇄ 場所移動・S 玩家起點；右上角數字＝事件頁數</div>
            </div>
          )}
          <div className="panel-section">
            <div className="row">
              <div className="section-title grow">地圖</div>
              <button className="btn small" onClick={() => addMap()} data-testid="add-map" title="新增地圖">
                ＋
              </button>
              <button className="btn small" onClick={() => addMap(map.id)} title="在目前地圖底下新增子地圖">
                ＋子
              </button>
            </div>
            <div className="map-tree">
              {mapTree(project.maps).map(({ map: m, depth }) => (
                <button key={m.id} className={`map-node${m.id === map.id ? " active" : ""}`} style={{ paddingLeft: 6 + depth * 14 }} onClick={() => setMapId(m.id)}>
                  {depth > 0 ? "└ " : ""}🗺 {m.name}
                  <span className="muted small">
                    {" "}
                    {m.width}×{m.height}・{m.events.length} 事件
                  </span>
                </button>
              ))}
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              <label className="field">
                名稱
                <input key={`n-${map.id}-${map.name}`} type="text" defaultValue={map.name} onBlur={(e) => e.target.value && e.target.value !== map.name && dispatch([{ op: "map.update", id: map.id, name: e.target.value }])} />
              </label>
              <label className="field">
                背景音樂
                <select value={map.music ?? "adventure"} onChange={(e) => dispatch([{ op: "map.update", id: map.id, music: e.target.value as (typeof MUSIC_MOODS)[number] }])}>
                  {MUSIC_MOODS.map((m) => (
                    <option key={m} value={m}>
                      {MUSIC_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button
                  className="btn small"
                  onClick={() => {
                    const size = window.prompt("新的寬×高", `${map.width}x${map.height}`);
                    const [w, h] = (size ?? "").split(/[x×*]/).map((n) => Number.parseInt(n, 10));
                    if (w && h) dispatch([{ op: "map.resize", id: map.id, width: Math.min(64, Math.max(3, w)), height: Math.min(64, Math.max(3, h)) }]);
                  }}
                >
                  調整大小
                </button>
                <button className="btn small danger" disabled={project.maps.length <= 1} onClick={() => window.confirm(`刪除地圖「${map.name}」與上面的所有事件？`) && dispatch([{ op: "map.remove", id: map.id }])}>
                  刪除
                </button>
              </div>
            </div>
          </div>
        </aside>

        <main className="studio-center">
          <MapCanvas
            project={project}
            scene={map}
            mode={mode}
            zoom={zoom}
            selected={selected}
            preview={preview}
            onPaint={paint}
            onPaintEnd={paintEnd}
            onSelect={(x, y) => setSelected({ x, y })}
            onCreate={openEvent}
            onMoveEvent={(id, x, y) => dispatch([{ op: "event.move", mapId: map.id, id, x, y }])}
          />
        </main>

        <aside className="studio-right">
          {mode === "event" && selected ? (
            <div className="stack" style={{ gap: 10 }} data-testid="cell-panel">
              <div className="section-title">
                {map.name} ({selected.x},{selected.y})・{TERRAIN[[...map.terrain[selected.y]][selected.x]]?.name}
              </div>
              {cellEvents.map((ev) => (
                <div key={ev.id} className="panel-section stack" style={{ gap: 6 }}>
                  <div className="row">
                    <strong className="grow">{ev.name}</strong>
                    <span className="mono small muted">{ev.id}</span>
                  </div>
                  {ev.pages.map((pg, i) => (
                    <div key={i} className="small muted">
                      第 {i + 1} 頁：{describePageConditions(project, pg)}｜{TRIGGER_LABEL[pg.trigger]}｜{pg.commands.length} 個指令
                    </div>
                  ))}
                  {ev.note && <div className="small">📝 {ev.note}</div>}
                  <div className="row">
                    <button className="btn small primary" onClick={() => setEditing({ event: ev, isNew: false })} data-testid="edit-event">
                      編輯事件
                    </button>
                    <button className="btn small danger" onClick={() => window.confirm(`刪除事件「${ev.name}」？`) && dispatch([{ op: "event.remove", mapId: map.id, id: ev.id }])}>
                      刪除
                    </button>
                  </div>
                </div>
              ))}
              {cellEvents.length === 0 && (
                <>
                  <button className="btn small primary" onClick={() => openEvent(selected.x, selected.y)} data-testid="new-event">
                    ＋ 新增事件（空白）
                  </button>
                  <div className="section-title">快速事件建立</div>
                  <div className="quick-grid">
                    {QUICK_EVENTS.map(([kind, label, hint]) => (
                      <button
                        key={kind}
                        className="btn small"
                        title={hint}
                        data-testid={`quick-${kind}`}
                        onClick={() => setEditing({ event: quickEvent(kind, project, map, selected.x, selected.y), isNew: true })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <div className="row">
                <button
                  className="btn small"
                  disabled={!map.walkable[selected.y]?.[selected.x]}
                  onClick={() => dispatch([{ op: "system.update", start: { mapId: map.id, x: selected.x, y: selected.y } }])}
                >
                  設為玩家起點
                </button>
                <button className="btn small" disabled={!map.walkable[selected.y]?.[selected.x]} onClick={() => void playtest(`&map=${map.id}&x=${selected.x}&y=${selected.y}`)} data-testid="play-here">
                  ▶ 從這裡測試
                </button>
              </div>
            </div>
          ) : (
            <div className="small muted">{mode === "event" ? "點選地圖上的格子來查看或新增事件。" : "選擇圖塊後在地圖上拖曳繪製；切到「事件」模式來放置人物、門、寶箱與劇情。"}</div>
          )}
          <div className="op-log" data-testid="op-log">
            <div className="section-title">操作紀錄</div>
            {log.map((l, i) => (
              <div key={i} className={`small ${l.ok ? "muted" : "err-text"}`}>
                {l.ok ? "✓" : "✗"} {l.text}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {conflict && (
        <div className="studio-banner" data-testid="conflict">
          ⚠ 專案在別處被修改了（第 {conflict.version} 版：{conflict.label}）。
          <button className="btn small" onClick={() => void loadRemote("已載入最新版本（你未儲存的修改已捨棄）")}>
            載入最新版本
          </button>
          <button className="btn small" onClick={() => void save(true)}>
            以我的版本覆蓋
          </button>
        </div>
      )}
      {toast && (
        <div className="studio-toast" data-testid="studio-toast">
          {toast}
        </div>
      )}
      {tour !== null && (
        <div className="tour-overlay" data-testid="tour">
          <div className="tour-card">
            <div className="small muted">
              導覽 {tour + 1} / {TOUR.length}
            </div>
            <h2>{TOUR[tour].title}</h2>
            <p>{TOUR[tour].text}</p>
            <div className="row">
              <button
                className="btn small"
                onClick={() => {
                  setTour(null);
                  try {
                    window.localStorage.setItem(TOUR_KEY, "1");
                  } catch {
                    // 略過
                  }
                }}
              >
                略過
              </button>
              <span className="grow" />
              {tour > 0 && (
                <button className="btn small" onClick={() => setTour(tour - 1)}>
                  上一步
                </button>
              )}
              <button
                className="btn small primary"
                onClick={() => {
                  if (tour < TOUR.length - 1) setTour(tour + 1);
                  else {
                    setTour(null);
                    try {
                      window.localStorage.setItem(TOUR_KEY, "1");
                    } catch {
                      // 略過
                    }
                  }
                }}
              >
                {tour < TOUR.length - 1 ? "下一步" : "開始製作"}
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <EventEditor
          key={`${editing.event.id}:${editing.isNew}`}
          project={project}
          event={editing.event}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onDelete={() => {
            dispatch([{ op: "event.remove", mapId: map.id, id: editing.event.id }]);
            setEditing(null);
          }}
          onOk={(event, close) => {
            dispatch([{ op: "event.upsert", mapId: map.id, event }]);
            setEditing(close ? null : { event, isNew: false });
          }}
        />
      )}
      {db && (
        <Database
          project={project}
          report={report}
          tab={db.tab}
          focusId={db.focusId}
          dispatch={dispatch}
          onTab={(tab, focusId) => setDb({ tab, focusId: focusId ?? null })}
          onClose={() => setDb(null)}
          onTestChapter={(id) => void playtest(`&chapter=${encodeURIComponent(id)}`)}
        />
      )}
    </div>
  );
}
