"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MUSIC_MOODS, TERRAIN } from "@/game/assets";
import type { GameProject } from "@/game/schema";
import { downloadJson, exportProjectJson } from "@/game/storage";
import { ApiError, studioApi } from "@/lib/studioApi";
import { applyOps, describeOp, type StudioOp } from "@/studio/ops";
import Database, { type DbTab } from "./Database";
import EventEditor from "./EventEditor";
import MapCanvas, { TilePalette, type MapMode } from "./MapCanvas";

/**
 * RPG Maker 式 Studio 編輯器。
 * 版面：上方工具列｜左側圖塊調色盤＋地圖清單｜中間地圖畫布｜右側事件編輯器；資料庫另開視窗。
 * 所有編輯都轉成 Studio 操作 API（src/studio/ops.ts），與 AI 使用同一套操作。
 * 快捷鍵：Ctrl/⌘+Z 復原、Ctrl/⌘+Shift+Z 重做、Ctrl/⌘+S 儲存、F9 資料庫、F5 測試遊玩、Esc 關閉資料庫。
 * 專案存在雲端（後台 API）：有修改時每 20 秒自動儲存；每 8 秒檢查雲端版本，AI 透過 API Token 的修改會即時出現。
 */

const AUTOSAVE_MS = 20_000;
const POLL_MS = 8_000;
const TOUR_KEY = "rpg:studio-tour-done";
const TOUR = [
  { title: "歡迎使用 Studio", text: "這裡是 RPG 的編輯器。上方工具列可以切換「🖌 地圖」與「❗ 事件」兩種模式，也能開啟「📚 資料庫」與「▶ 測試遊玩」。" },
  { title: "🖌 地圖模式", text: "從左側「圖塊」選一種地形（草地、道路、樹、房屋…），在中間的畫布上按住拖曳就能繪製。✕ 代表不可通行。" },
  { title: "❗ 事件模式", text: "點選格子會在右側顯示上面的事件；雙擊空格可以新增 NPC、調查點、撿取物、出口、地點，或設為玩家起點。" },
  { title: "📚 資料庫與儲存", text: "對話、任務、物品、結局都在資料庫（F9）。修改會每 20 秒自動存到雲端，也可以按 Ctrl/⌘+S；每次儲存都會留下版本，可以隨時還原。" },
];

const HISTORY_LIMIT = 100;
const MUSIC_LABELS: Record<string, string> = { peaceful: "平和", lively: "熱鬧", adventure: "冒險", mysterious: "神秘", tense: "緊張", melancholy: "感傷" };

export default function StudioApp({ projectId, initialDb }: { projectId: string; initialDb?: DbTab | null }) {
  const [project, setProject] = useState<GameProject | null>(null);
  const [notFound, setNotFound] = useState(false);
  // 復原／重做的歷史放在 ref，state 只記筆數（觸發重繪）
  const historyRef = useRef<{ past: Array<{ project: GameProject; label: string }>; future: Array<{ project: GameProject; label: string }> }>({ past: [], future: [] });
  const [counts, setCounts] = useState({ past: 0, future: 0 });
  const [dirty, setDirty] = useState(false);
  const [sceneId, setSceneId] = useState<string>("");
  const [mode, setMode] = useState<MapMode>("map");
  const [tool, setTool] = useState<"pen" | "fill">("pen");
  const [brush, setBrush] = useState(".");
  const [zoom, setZoom] = useState(32);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<Map<string, string>>(new Map());
  const [db, setDb] = useState<{ tab: DbTab; focusId: string | null } | null>(null);
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

  const loadRemote = useCallback(async (message?: string) => {
    try {
      const r = await studioApi.getProject(projectId);
      projectRef.current = r.project;
      baseVersionRef.current = r.version;
      setBaseVersion(r.version);
      setProject(r.project);
      setSceneId((s) => (r.project.scenes.some((x) => x.id === s) ? s : r.project.startSceneId));
      historyRef.current = { past: [], future: [] };
      setCounts({ past: 0, future: 0 });
      markDirty(false);
      setConflict(null);
      if (message) setToast(message);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
    }
  }, [projectId]);

  useEffect(() => {
    void loadRemote();
    if (initialDb) setDb({ tab: initialDb, focusId: null });
    try {
      if (!window.localStorage.getItem(TOUR_KEY)) requestAnimationFrame(() => setTour(0));
    } catch {
      // 無法記住導覽狀態時略過
    }
  }, [loadRemote, initialDb]);

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
        const r = await studioApi.saveProject(projectId, p, overwrite ? undefined : baseVersionRef.current, label);
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

  const playtest = useCallback(async () => {
    if (await save()) window.open(`/studio/play/?id=${encodeURIComponent(projectId)}`, "_blank");
  }, [save, projectId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (!typing && mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === "F9") {
        e.preventDefault();
        setDb((d) => (d ? null : { tab: "dialogues", focusId: null }));
      } else if (e.key === "F5") {
        e.preventDefault();
        void playtest();
      } else if (e.key === "Escape") setDb(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, undo, redo, playtest]);

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
  const scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0];
  const tileset = project.assetManifest.assets.find((a) => a.id === scene.tilesetId);

  const paint = (x: number, y: number) => {
    if (tool === "fill") {
      dispatch([{ op: "scene.fill", sceneId: scene.id, x, y, ch: brush }]);
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
      dispatch([{ op: "scene.paint", sceneId: scene.id, cells: [...preview].map(([k, ch]) => ({ x: Number(k.split(",")[0]), y: Number(k.split(",")[1]), ch })) }]);
    }
    setPreview(new Map());
  };

  const addScene = () => {
    const name = window.prompt("新地圖名稱", "新地圖");
    if (!name) return;
    const size = window.prompt("寬×高（例如 20x15）", "20x15") ?? "20x15";
    const [w, h] = size.split(/[x×*]/).map((n) => Number.parseInt(n, 10));
    let i = 1;
    while (project.scenes.some((s) => s.id === `map_${i}`)) i++;
    dispatch([{ op: "scene.add", id: `map_${i}`, name, width: Math.min(64, Math.max(5, w || 20)), height: Math.min(64, Math.max(5, h || 15)) }]);
    setSceneId(`map_${i}`);
  };

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
        <button className="btn small" onClick={() => setDb({ tab: "dialogues", focusId: null })} title="資料庫（F9）" data-testid="open-database">
          📚 資料庫
        </button>
        <span className="grow" />
        <button className={`badge ${report.isValid ? "ok" : "err"}`} onClick={() => setDb({ tab: "validation", focusId: null })} data-testid="validation-badge">
          {report.isValid ? `✓ 驗證通過${report.warnings.length ? `（${report.warnings.length} 警告）` : ""}` : `✗ ${report.errors.length} 個錯誤`}
        </button>
        <button className="btn small" onClick={() => downloadJson(`${project.id}.json`, exportProjectJson(project))}>
          匯出
        </button>
        <button className="btn small" onClick={() => setTour(0)} title="重新顯示導覽">
          ？導覽
        </button>
        <button className="btn small primary" onClick={() => void playtest()} title="測試遊玩（F5）" data-testid="studio-play">
          ▶ 測試遊玩
        </button>
      </div>

      <div className="studio-main">
        <aside className="studio-left">
          {mode === "map" ? (
            <div className="panel-section">
              <div className="section-title">圖塊</div>
              {tileset && <TilePalette tilesetSrc={tileset.src} value={brush} onChange={setBrush} />}
              <div className="small muted" style={{ marginTop: 6 }}>
                目前：{TERRAIN[brush]?.name}（{TERRAIN[brush]?.walkable ? "可通行" : "不可通行"}）
              </div>
            </div>
          ) : (
            <div className="panel-section small muted">
              事件模式：點格子選取事件，雙擊空格新增 NPC、調查點、撿取物、出口或地點。
              <div style={{ marginTop: 8 }}>
                圖例：👤 NPC・<span style={{ color: "#ff7ad9" }}>！</span>調查點・⇄ 出口・<span style={{ color: "#f2b84b" }}>■</span>地點・S 玩家起點
              </div>
            </div>
          )}
          <div className="panel-section">
            <div className="row">
              <div className="section-title grow">地圖</div>
              <button className="btn small" onClick={addScene} data-testid="add-scene">
                ＋
              </button>
            </div>
            <div className="map-tree">
              {project.scenes.map((s) => (
                <button key={s.id} className={`map-node${s.id === scene.id ? " active" : ""}`} onClick={() => setSceneId(s.id)}>
                  🗺 {s.name}
                  <span className="muted small">
                    {" "}
                    {s.width}×{s.height}
                  </span>
                </button>
              ))}
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              <label className="field">
                名稱
                <input key={`n-${scene.id}-${scene.name}`} type="text" defaultValue={scene.name} onBlur={(e) => e.target.value && e.target.value !== scene.name && dispatch([{ op: "scene.update", id: scene.id, name: e.target.value }])} />
              </label>
              <label className="field">
                背景音樂
                <select value={scene.music ?? "adventure"} onChange={(e) => dispatch([{ op: "scene.update", id: scene.id, music: e.target.value as (typeof MUSIC_MOODS)[number] }])}>
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
                    const size = window.prompt("新的寬×高", `${scene.width}x${scene.height}`);
                    const [w, h] = (size ?? "").split(/[x×*]/).map((n) => Number.parseInt(n, 10));
                    if (w && h) dispatch([{ op: "scene.resize", id: scene.id, width: Math.min(64, Math.max(3, w)), height: Math.min(64, Math.max(3, h)) }]);
                  }}
                >
                  調整大小
                </button>
                <button className="btn small danger" disabled={project.scenes.length <= 1} onClick={() => window.confirm(`刪除地圖「${scene.name}」？`) && dispatch([{ op: "scene.remove", id: scene.id }])}>
                  刪除
                </button>
              </div>
            </div>
          </div>
        </aside>

        <main className="studio-center">
          <MapCanvas
            project={project}
            scene={scene}
            mode={mode}
            zoom={zoom}
            selected={selected}
            preview={preview}
            onPaint={paint}
            onPaintEnd={paintEnd}
            onSelect={(x, y) => setSelected({ x, y })}
            onCreate={(x, y) => setSelected({ x, y })}
          />
        </main>

        <aside className="studio-right">
          {mode === "event" && selected ? (
            <EventEditor project={project} scene={scene} cell={selected} dispatch={dispatch} openDialogue={(id) => setDb({ tab: "dialogues", focusId: id })} />
          ) : (
            <div className="small muted">{mode === "event" ? "點選地圖上的格子來編輯事件。" : "選擇圖塊後在地圖上拖曳繪製；切到「事件」模式來放置 NPC 與調查點。"}</div>
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
      {db && (
        <Database
          project={project}
          report={report}
          tab={db.tab}
          focusId={db.focusId}
          dispatch={dispatch}
          onTab={(tab, focusId) => setDb({ tab, focusId: focusId ?? null })}
          onClose={() => setDb(null)}
        />
      )}
    </div>
  );
}
