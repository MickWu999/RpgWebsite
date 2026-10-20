"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { studioApi, type ProjectSummary } from "@/lib/studioApi";
import StudioShell, { PageHeader } from "../StudioShell";

/** 專案列表：新增（空白／範本）、匯入、開啟、複製、典藏（軟刪除，可還原） */
export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<"blank" | "demo">("demo");
  const [showArchived, setShowArchived] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 每次請求編號，只採用最新一次的結果：避免切換分頁時，較晚回來的舊請求覆蓋畫面
  const requestSeq = useRef(0);
  const refresh = (archived = showArchived) => {
    const seq = ++requestSeq.current;
    return studioApi
      .listProjects(archived)
      .then((r) => seq === requestSeq.current && setProjects(r.projects))
      .catch((e: Error) => seq === requestSeq.current && setError(e.message));
  };

  useEffect(() => {
    void refresh(showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

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
        <div className="tabs" role="tablist">
          <button className={`tab${showArchived ? "" : " active"}`} onClick={() => setShowArchived(false)} data-testid="tab-active">
            使用中
          </button>
          <button className={`tab${showArchived ? " active" : ""}`} onClick={() => setShowArchived(true)} data-testid="tab-archived">
            🗄 典藏
          </button>
        </div>
        {showArchived && <div className="notice info small">典藏的專案資料與版本紀錄都完整保留，按「還原」就會回到使用中。已發布的遊戲不會因為典藏而下架。</div>}
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
        {projects?.length === 0 && showArchived && <div className="muted">典藏區沒有專案。</div>}
        {projects?.length === 0 && !creating && !showArchived && (
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
                {p.archived_at ? (
                  <>
                    <span className="small muted grow">典藏於 {new Date(p.archived_at).toLocaleString("zh-TW", { hour12: false })}</span>
                    <button
                      className="btn small primary"
                      data-testid="unarchive"
                      onClick={async () => {
                        await studioApi.unarchiveProject(p.id);
                        void refresh();
                      }}
                    >
                      還原
                    </button>
                  </>
                ) : (
                  <>
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
                      className="btn small"
                      data-testid="archive"
                      onClick={async () => {
                        if (!window.confirm(`把「${p.title}」移到典藏區？資料與版本紀錄都會保留，之後可以在「典藏」還原。`)) return;
                        await studioApi.archiveProject(p.id);
                        void refresh();
                      }}
                    >
                      🗄 典藏
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </StudioShell>
  );
}
