"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import IssueList from "@/components/IssueList";
import CoverArt from "@/components/game/CoverArt";
import { InstallPrompt } from "@/components/PwaSupport";
import { projectFromFixture } from "@/game/fixtureProject";
import { GENRE_LABELS, type GameProject } from "@/game/schema";
import {
  DEMO_PROJECT_ID,
  deleteProject,
  downloadJson,
  listProjects,
  loadProject,
  newProjectId,
  parseProjectJson,
  saveProject,
  type ProjectMetadata,
} from "@/game/storage";
import type { ValidationIssue } from "@/game/validate";
import { bridgeGenerate, checkBridge, type BridgeStatus } from "@/lib/aiBridge";
import { STATUS_LABELS } from "@/lib/labels";
import { fetchCatalog, type CatalogEntry } from "@/lib/packs";

const STYLES = ["冒險", "輕鬆", "嚴肅", "黑暗"];
const SOURCE_LABELS: Record<ProjectMetadata["source"], string> = {
  demo: "內建 demo",
  ai: "AI 生成",
  fixture: "demo 範本",
  import: "匯入",
  manual: "手動",
};

export default function Home() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectMetadata[]>([]);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [title, setTitle] = useState("");
  const [story, setStory] = useState("");
  const [genre, setGenre] = useState<GameProject["genre"]>("fantasy");
  const [style, setStyle] = useState(STYLES[0]);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState<{ kind: "info" | "err"; text: string } | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [failedRaw, setFailedRaw] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const [library, setLibrary] = useState<CatalogEntry[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const refresh = () => setProjects(listProjects().filter((p) => p.id !== DEMO_PROJECT_ID));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 專案列表存在 localStorage，只能在瀏覽器端讀取
    refresh();
    checkBridge().then(setBridge);
    fetchCatalog()
      .then((c) => setLibrary(c.games))
      .catch((e: Error) => setLibraryError(e.message));
  }, []);

  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const storyOk = story.trim().length >= 10;

  const createFromFixture = () => {
    const id = newProjectId(title || "rpg");
    const project = projectFromFixture({ projectId: id, title: title || undefined, story, genre });
    saveProject(project, { source: "fixture", story });
    router.push(`/studio/?id=${encodeURIComponent(id)}`);
  };

  const createWithAi = async () => {
    setBusy(true);
    setElapsed(0);
    setMessage({ kind: "info", text: "本機 Claude Code 正在依故事生成遊戲資料，通常需要 1～4 分鐘…" });
    setIssues([]);
    setFailedRaw(null);
    try {
      const id = newProjectId(title || "rpg");
      const result = await bridgeGenerate({ story, title: title || undefined, genre, style, projectId: id });
      if (result.project) {
        saveProject(result.project, { source: result.source === "ai" ? "ai" : "fixture", story, pipelineStatus: result.status });
        router.push(`/studio/?id=${encodeURIComponent(result.project.id)}`);
        return;
      }
      setMessage({ kind: "err", text: result.message });
      setIssues(result.report.errors);
      setFailedRaw(result.rawProject);
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    setIssues([]);
    if (file.size > 1024 * 1024) {
      setMessage({ kind: "err", text: "檔案超過 1 MB，已拒絕匯入" });
      return;
    }
    const result = parseProjectJson(await file.text());
    if (!result.project) {
      setMessage({ kind: "err", text: `「${file.name}」未通過驗證，已拒絕匯入` });
      setIssues(result.errors);
      return;
    }
    if (loadProject(result.project.id) && !window.confirm(`已存在 ID 為「${result.project.id}」的專案，要覆蓋嗎？（舊版本會保留在復原紀錄中）`)) return;
    saveProject(result.project, { source: "import" });
    router.push(`/studio/?id=${encodeURIComponent(result.project.id)}`);
  };

  return (
    <div className="container">
      <section className="hero">
        <h1>AI RPG Builder</h1>
        <p className="muted" style={{ maxWidth: 680 }}>
          把故事、世界觀與角色設定轉換成可以在瀏覽器遊玩的 2D RPG。故事轉成結構化遊戲資料，再由固定的 RPG Runtime 執行；AI 只是其中一種產生資料的方式，
          你也可以直接在 Studio 編輯或匯入 JSON。
        </p>
        <div className="row">
          <Link className="btn primary" href={`/play/?pack=${DEMO_PROJECT_ID}`} data-testid="play-demo">
            ▶ 試玩 demo：迷霧森林的燈火
          </Link>
          <Link className="btn" href={`/studio/?id=${DEMO_PROJECT_ID}`}>
            在 Studio 檢視 demo
          </Link>
          <InstallPrompt />
        </div>
      </section>

      <section className="library" aria-label="遊戲庫">
        <div className="row">
          <h2 className="grow" style={{ margin: 0 }}>
            遊戲庫
          </h2>
          <button className="btn small" aria-label="往左捲動" onClick={() => shelfRef.current?.scrollBy({ left: -320, behavior: "smooth" })}>
            ◀
          </button>
          <button className="btn small" aria-label="往右捲動" onClick={() => shelfRef.current?.scrollBy({ left: 320, behavior: "smooth" })}>
            ▶
          </button>
        </div>
        {libraryError && <div className="notice err">{libraryError}</div>}
        {library === null && !libraryError && <div className="muted small">載入遊戲目錄中…</div>}
        <div className="shelf" ref={shelfRef} data-testid="library">
          {library?.map((g) => (
            <Link key={g.id} className="game-card" href={`/play/?pack=${encodeURIComponent(g.id)}`} data-pack={g.id}>
              <div className="game-card-cover">
                <CoverArt cover={g.cover} />
                <div className="game-card-title">{g.title}</div>
              </div>
              <div className="game-card-body">
                <div className="row small">
                  <span className="badge">{GENRE_LABELS[g.genre]}</span>
                  {g.typicalMinutes && <span className="badge">約 {g.typicalMinutes[0]}～{g.typicalMinutes[1]} 分鐘</span>}
                  <span className="badge">{g.endings} 種結局</span>
                  {g.status === "approved" && <span className="badge ok">AI 生成・審查通過</span>}
                </div>
                <p className="small muted game-card-desc">{g.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid-2">
        <section className="panel stack">
          <h2>建立新遊戲</h2>
          <label className="field">
            專案名稱
            <input type="text" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="例如：深夜便利商店" />
          </label>
          <label className="field">
            故事／世界觀（10～8000 字）
            <textarea
              value={story}
              maxLength={8000}
              rows={8}
              onChange={(e) => setStory(e.target.value)}
              placeholder="例如：玩家是一名偵探，要調查一間深夜營業的便利商店，找出失蹤人口的真相……"
            />
          </label>
          <div className="row">
            <label className="field grow">
              類型
              <select value={genre} onChange={(e) => setGenre(e.target.value as GameProject["genre"])}>
                {Object.entries(GENRE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              敘事風格
              <select value={style} onChange={(e) => setStyle(e.target.value)}>
                {STYLES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field grow">
              視角
              <select disabled value="2d">
                <option value="2d">2D 俯視角（MVP 僅支援）</option>
              </select>
            </label>
          </div>

          <div className="small muted">
            本機 AI：
            {bridge === null ? (
              "偵測中…"
            ) : bridge.available ? (
              <span className="badge ok">可用（{bridge.detail}）</span>
            ) : (
              <span className="badge warn">{bridge.reachable ? `bridge 已啟動但 CLI 不可用：${bridge.detail}` : "AI 生成僅限本機：請在本機執行 npm run ai"}</span>
            )}
          </div>
          <div className="row">
            <button className="btn primary" disabled={!storyOk || busy || !bridge?.available} onClick={createWithAi}>
              {busy ? `生成中…（${elapsed} 秒）` : "AI 生成（本機 Claude Code）"}
            </button>
            <button className="btn" disabled={busy} onClick={createFromFixture} data-testid="create-fixture">
              用 demo 範本建立
            </button>
          </div>
          {message && <div className={`notice ${message.kind}`}>{message.text}</div>}
          <IssueList errors={issues} warnings={[]} />
          {failedRaw !== null && (
            <div className="row">
              <button className="btn small" onClick={() => downloadJson("ai-output-invalid.json", JSON.stringify(failedRaw, null, 2))}>
                下載未通過驗證的輸出
              </button>
              <button className="btn small" disabled={busy} onClick={createWithAi}>
                重新生成
              </button>
              <button className="btn small" onClick={createFromFixture}>
                改用 demo 範本
              </button>
            </div>
          )}
        </section>

        <section className="panel stack">
          <div className="row">
            <h2 className="grow" style={{ margin: 0 }}>
              我的專案
            </h2>
            <button className="btn small" onClick={() => fileRef.current?.click()}>
              匯入 JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              data-testid="import-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importFile(f);
                e.target.value = "";
              }}
            />
          </div>
          <div className="small muted">專案與遊戲進度存在此瀏覽器的 localStorage；換裝置或清除網站資料前請先匯出 JSON。</div>
          <div>
            <div className="project-item">
              <div className="grow">
                <strong>迷霧森林的燈火</strong> <span className="badge">內建 demo</span>
              </div>
              <Link className="btn small" href={`/play/?id=${DEMO_PROJECT_ID}`}>
                試玩
              </Link>
              <Link className="btn small" href={`/studio/?id=${DEMO_PROJECT_ID}`}>
                Studio
              </Link>
            </div>
            {projects.map((p) => (
              <div key={p.id} className="project-item">
                <div className="grow">
                  <strong>{p.title}</strong> <span className="badge">{SOURCE_LABELS[p.source]}</span>{" "}
                  {p.pipelineStatus && STATUS_LABELS[p.pipelineStatus] && (
                    <span className={`badge ${STATUS_LABELS[p.pipelineStatus][1]}`}>{STATUS_LABELS[p.pipelineStatus][0]}</span>
                  )}
                  <div className="small muted">更新於 {new Date(p.updatedAt).toLocaleString("zh-TW", { hour12: false })}</div>
                </div>
                <Link className="btn small" href={`/play/?id=${encodeURIComponent(p.id)}`}>
                  試玩
                </Link>
                <Link className="btn small" href={`/studio/?id=${encodeURIComponent(p.id)}`}>
                  Studio
                </Link>
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (window.confirm(`確定刪除「${p.title}」與它的存檔嗎？此動作無法復原。`)) {
                      deleteProject(p.id);
                      refresh();
                    }
                  }}
                >
                  刪除
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <p className="small muted" style={{ marginTop: 32 }}>
        美術素材：Kenney「Tiny Town」與「Tiny Dungeon」（CC0）。授權紀錄見 Studio 的「素材」頁籤。
      </p>
    </div>
  );
}
