"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { studioApi, type ProjectSummary } from "@/lib/studioApi";
import { GENRE_LABELS } from "@/game/schema";
import Pipeline from "../Pipeline";
import StudioShell, { PageHeader } from "../StudioShell";

/**
 * 專案列表（AI 製作看板）：每張卡片顯示 AI 製作進度與下一步。
 * 新增專案＝「交給 AI 一個故事」：寫下故事或題材，AI 在 VS Code 用 npm run game -- remote story <id> 讀取後開始製作。
 */
export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<"blank" | "demo">("blank");
  const [story, setStory] = useState("");
  const [genre, setGenre] = useState("fantasy");
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
      const { id } = await studioApi.createProject(title.trim() || "未命名專案", template, template === "blank" ? { story, genre } : {});
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
          subtitle="每個專案就是一款 RPG。寫下故事交給 AI，這裡會即時顯示 AI 做到哪一章、審查的結果，以及下一步。"
          actions={
            <>
              <button className="btn" onClick={() => fileRef.current?.click()}>
                匯入 JSON
              </button>
              <button className="btn primary" onClick={() => setCreating(true)} data-testid="new-project">
                ＋ 交給 AI 一個故事
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
            <h2>{template === "blank" ? "交給 AI 一個故事" : "從範本開始（手動學習）"}</h2>
            <div className="row">
              <label className="field grow">
                遊戲名稱
                <input type="text" value={title} autoFocus placeholder="例如：最後一班夜哨" onChange={(e) => setTitle(e.target.value)} />
              </label>
              {template === "blank" && (
                <label className="field">
                  類型
                  <select value={genre} onChange={(e) => setGenre(e.target.value)}>
                    {Object.entries(GENRE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            {template === "blank" ? (
              <label className="field">
                故事或題材（一句話也可以；寫得越具體，AI 越能抓到你要的感覺）
                <textarea
                  rows={7}
                  value={story}
                  onChange={(e) => setStory(e.target.value)}
                  data-testid="new-story"
                  placeholder={"例如：\n一個新兵在懇親會前一週，想挽回和爸爸的關係。營區裡流傳著老兵的鬼故事，班長似乎藏著什麼秘密。\n希望有溫馨也有好笑的地方，結局可以因為玩家的選擇而不同。"}
                />
              </label>
            ) : (
              <div className="small muted">複製《迷霧森林的燈火》：2 章的短篇，含人物、寶箱、場所移動、多頁事件與 2 種結局，適合邊看邊學 RPG Maker 式的事件寫法。</div>
            )}
            <div className="row">
              <button className="btn primary" onClick={create} data-testid="create-project" disabled={template === "blank" && !story.trim()}>
                {template === "blank" ? "建立並交給 AI" : "建立"}
              </button>
              <button className="btn" onClick={() => setCreating(false)}>
                取消
              </button>
              <span className="grow" />
              <button className="link-button small" onClick={() => setTemplate(template === "blank" ? "demo" : "blank")} data-testid="toggle-template">
                {template === "blank" ? "想自己動手？改用範本專案學習 →" : "← 改回交給 AI 製作"}
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
            <p className="muted">寫下一段故事或題材交給 AI。AI 會先寫劇本大綱並通過審查，再一章一章製作，每一步都會顯示在這裡。</p>
            <button className="btn primary" onClick={() => setCreating(true)}>
              ＋ 交給 AI 一個故事
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
                {!p.archived_at && (
                  <Pipeline
                    compact
                    input={{
                      hasStory: Boolean(p.has_story),
                      hasTreatment: Boolean(p.has_treatment),
                      treatmentPassed: p.treatment_passed === null ? null : p.treatment_passed === 1,
                      chapters: Array.from({ length: p.chapters_total ?? 0 }, (_, i) => ({ title: `第 ${i + 1} 章`, reviewPassed: i < p.chapters_passed ? true : null })),
                      fullPassed: p.full_passed === null ? null : p.full_passed === 1,
                      published: Boolean(p.published_version),
                    }}
                  />
                )}
                <div className="small muted" style={{ marginTop: 6 }}>
                  {p.last_actor?.includes("API Token") ? "🤖" : "👤"} {p.last_actor ?? ""}・更新於 {new Date(p.updated_at).toLocaleString("zh-TW", { hour12: false })}
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
                    <button className="btn small" onClick={() => router.push(`/studio/project/?id=${p.id}`)}>
                      製作看板
                    </button>
                    <button className="btn small" onClick={() => router.push(`/studio/edit/?id=${p.id}`)}>
                      編輯器
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
