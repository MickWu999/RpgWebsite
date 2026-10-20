"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { studioApi, type ProjectSummary } from "@/lib/studioApi";
import StudioShell, { PageHeader } from "../StudioShell";

/** 專案列表：新增（空白／範本）、匯入、開啟、複製、刪除 */
export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<"blank" | "demo">("demo");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    studioApi
      .listProjects()
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    void refresh();
  }, []);

  const create = async () => {
    try {
      const { id } = await studioApi.createProject(title.trim() || "未命名專案", template);
      router.push(`/studio/project/?id=${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      const { id } = await studioApi.importProject(data);
      router.push(`/studio/project/?id=${id}`);
    } catch (e) {
      setError(`匯入失敗：${(e as Error).message}`);
    }
  };

  return (
    <StudioShell>
      <div className="page">
        <PageHeader
          title="專案"
          subtitle="每個專案就是一款 RPG。專案存在雲端，換電腦登入也看得到；人與 AI（透過 API Token）都能編輯。"
          actions={
            <>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                匯入 JSON
              </button>
              <button className="btn primary" onClick={() => setCreating(true)} data-testid="new-project">
                ＋ 新增專案
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            </>
          }
        />
        {error && <div className="notice err">{error}</div>}

        {creating && (
          <div className="card stack" data-testid="new-project-form">
            <h2>新增專案</h2>
            <label className="field">
              遊戲名稱
              <input type="text" value={title} autoFocus placeholder="例如：最後一班夜哨" onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="template-picker">
              <button className={`template${template === "demo" ? " active" : ""}`} onClick={() => setTemplate("demo")}>
                <b>🌲 從範本開始（建議新手）</b>
                <span className="small muted">複製《迷霧森林的燈火》：已有 2 張地圖、2 位 NPC、任務與 2 種結局，可以邊改邊學。</span>
              </button>
              <button className={`template${template === "blank" ? " active" : ""}`} onClick={() => setTemplate("blank")}>
                <b>📄 空白專案</b>
                <span className="small muted">只有一張空地圖與主角，適合從零設計，或交給 AI agent 製作。</span>
              </button>
            </div>
            <div className="row">
              <button className="btn primary" onClick={create} data-testid="create-project">
                建立
              </button>
              <button className="btn" onClick={() => setCreating(false)}>
                取消
              </button>
            </div>
          </div>
        )}

        {projects === null && !error && <div className="muted">載入中…</div>}
        {projects?.length === 0 && !creating && (
          <div className="empty-state">
            <div className="empty-icon">🎮</div>
            <h2>還沒有任何專案</h2>
            <p className="muted">按「新增專案」開始做第一款 RPG。第一次使用建議選「從範本開始」，照著專案總覽的製作清單一步步完成。</p>
            <button className="btn primary" onClick={() => setCreating(true)}>
              ＋ 新增專案
            </button>
          </div>
        )}
        <div className="project-grid">
          {projects?.map((p) => (
            <div key={p.id} className="project-card" data-testid="project-card">
              <button className="project-open" onClick={() => router.push(`/studio/project/?id=${p.id}`)}>
                <div className="project-title">{p.title}</div>
                <div className="small muted mono">{p.id}</div>
                <div className="row small" style={{ marginTop: 8 }}>
                  <span className={`badge ${p.is_valid ? "ok" : "warn"}`}>{p.is_valid ? "驗證通過" : "製作中"}</span>
                  <span className="badge">第 {p.version} 版</span>
                  {p.published_version && <span className="badge ok">已發布 v{p.published_version}</span>}
                </div>
                <div className="small muted" style={{ marginTop: 6 }}>
                  更新於 {new Date(p.updated_at).toLocaleString("zh-TW", { hour12: false })}
                </div>
              </button>
              <div className="row project-actions">
                <button className="btn small" onClick={() => router.push(`/studio/edit/?id=${p.id}`)}>
                  開啟編輯器
                </button>
                <button
                  className="btn small"
                  onClick={async () => {
                    await studioApi.duplicateProject(p.id);
                    void refresh();
                  }}
                >
                  複製
                </button>
                <button
                  className="btn small danger"
                  onClick={async () => {
                    if (!window.confirm(`確定刪除「${p.title}」？所有版本紀錄與已發布的遊戲都會一起刪除，無法復原。`)) return;
                    await studioApi.deleteProject(p.id);
                    void refresh();
                  }}
                >
                  刪除
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </StudioShell>
  );
}
