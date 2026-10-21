"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import CoverArt from "@/components/game/CoverArt";
import IssueList from "@/components/IssueList";
import { walkProject } from "@/game/commands";
import { coverDataOf } from "@/game/cover";
import type { GameProject } from "@/game/schema";
import { projectRevision } from "@/game/engine";
import { studioApi, type CheckResult, type FeedbackEntry, type NoteEntry, type PlayAnalytics, type ProjectDoc, type ReviewEntry, type VersionEntry } from "@/lib/studioApi";
import Pipeline from "../Pipeline";
import { runCheckAsync } from "@/studio/check";
import StudioShell, { PageHeader } from "../StudioShell";

/**
 * 專案總覽：製作進度清單（依專案內容自動打勾，每一步都有「前往」）、規模與時長、封面預覽、最近版本。
 * 讓第一次使用的人照著清單做，就能完成一款可以發布的 RPG。
 */

type Step = { done: boolean; title: string; how: string; href: string; cta: string };

function steps(p: GameProject, id: string, check: CheckResult | null, published: boolean): Step[] {
  const edit = `/studio/edit/?id=${id}`;
  const terrainKinds = new Set(p.maps.flatMap((m) => [...m.terrain.join("")]));
  const events = p.maps.flatMap((m) => m.events);
  const hasTransfer = events.some((e) => e.pages.some((pg) => pg.commands.some((c) => c.code === "transfer")));
  const people = events.filter((e) => e.pages.some((pg) => pg.graphic?.assetId.startsWith("char_"))).length;
  const looks = events.filter((e) => e.pages.some((pg) => pg.trigger === "action" && !pg.graphic?.assetId.startsWith("char_"))).length;
  let texts = 0;
  walkProject(p, (c) => c.code === "text" && texts++);
  const placeholder = p.endings.some((e) => e.id === "end_placeholder");
  return [
    { done: p.description !== "（待補）" && p.description.length >= 10, title: "1. 寫下遊戲名稱與簡介", how: "在「資料庫 → 系統」設定名稱、簡介、開場訊息與封面。", href: `${edit}&db=system`, cta: "開啟系統設定" },
    { done: p.actors.length >= 3, title: "2. 建立角色", how: "在「資料庫 → 角色」建立主角與主要人物：名稱、角色圖、講話聲，以及動機與秘密（角色設定）。", href: `${edit}&db=actors`, cta: "開啟角色" },
    { done: terrainKinds.size >= 4, title: "3. 畫出地圖", how: "在「地圖」模式選圖塊，在畫布上拖曳繪製道路、房屋、樹林。用地圖樹的「＋」新增地圖，「＋子」新增子地圖（例如民宅內部）。", href: edit, cta: "開啟地圖編輯器" },
    { done: p.maps.length >= 2 && hasTransfer, title: "4. 用場所移動連接地圖", how: "切到「事件」模式，在地圖邊緣選一格 →「快速事件建立 → 場所移動」，設定要通往哪張地圖。雙向通行要兩邊各放一個。", href: edit, cta: "放置場所移動" },
    { done: people >= 2, title: "5. 放置人物", how: "「事件」模式選一格 →「快速事件建立 → 人物」，選角色圖，在執行內容寫對話。用多個事件頁讓人物依劇情進度說不同的話。", href: edit, cta: "放置人物" },
    { done: texts >= 12, title: "6. 撰寫劇情", how: "在事件的執行內容加入「顯示文字」「顯示選項」「條件分支」，並用「開關操作」記下玩家的選擇。", href: edit, cta: "開啟事件" },
    { done: looks >= 2, title: "7. 加入調查點", how: "門、告示、寶箱、古井都是事件：「快速事件建立 → 調查點／寶箱」。玩家按確定鍵時一定要有回應，避免迷路。", href: edit, cta: "放置調查點" },
    { done: p.quests.some((q) => q.steps.length >= 3), title: "8. 建立任務日誌", how: "在「資料庫 → 任務」寫下步驟（找誰／去哪／做什麼），在事件中用「任務」指令開始與推進。", href: `${edit}&db=quests`, cta: "開啟任務" },
    { done: p.chapters.length >= 2 && p.chapters.every((c) => c.testStart), title: "9. 分章節", how: "在「資料庫 → 章節」建立章節並設定測試起點；在劇情轉折處用「章節」指令進入下一章。之後可以直接從某一章開始測試。", href: `${edit}&db=chapters`, cta: "開啟章節" },
    { done: p.endings.length >= 2 && !placeholder, title: "10. 設定結局", how: "在「資料庫 → 結局」設定 2～4 個結局與尾聲，在事件中依玩家累積的選擇用「結局」指令觸發。", href: `${edit}&db=endings`, cta: "開啟結局" },
    { done: Boolean(check?.playtest?.ok && check.validation.errors.length === 0), title: "11. 通過檢查與自動試玩", how: "系統會驗證所有引用，並自動把每個結局玩過一遍。錯誤會列在下方。", href: `/studio/publish/?id=${id}`, cta: "查看檢查結果" },
    { done: published, title: "12. 發布到玩家網站", how: "通過檢查後在「發布」頁按下發布，玩家網站會立即出現這款遊戲。", href: `/studio/publish/?id=${id}`, cta: "前往發布" },
  ];
}

const KIND_LABEL = { treatment: "劇本大綱", chapter: "章節", full: "整體" } as const;
const SCORE_LABEL: Record<string, string> = {
  fidelity: "忠於原作",
  structure: "結構",
  choices: "選擇",
  quests: "任務",
  characters: "角色",
  pacing: "節奏",
  endings: "結局",
  feedback: "回饋",
  arc: "故事弧線",
  fun: "好玩程度",
  hook: "開場鉤子",
  variety: "玩法變化",
  budget: "時長預算",
  premise: "前提新鮮度",
  surprise: "不好猜",
  soul: "故事靈魂",
};
const PERSONA_LABEL = { veteran: "老玩家", casual: "休閒玩家", story: "劇情派" } as const;
const time = (iso: string) => new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function ProjectOverview() {
  const id = useSearchParams().get("id") ?? "";
  const [data, setData] = useState<{ project: GameProject; version: number } | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [published, setPublished] = useState(false);
  const [docs, setDocs] = useState<Partial<Record<"story" | "treatment", ProjectDoc>>>({});
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);
  const [storyDraft, setStoryDraft] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([]);
  const [analytics, setAnalytics] = useState<PlayAnalytics | null>(null);
  const [notes, setNotes] = useState<NoteEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    studioApi
      .getProject(id)
      .then((r) => {
        setData({ project: r.project, version: r.version });
        // 檢查在瀏覽器執行（不佔伺服器 CPU）
        return runCheckAsync(r.project).then(setCheck);
      })
      .catch((e: Error) => setError(e.message));
    studioApi.versions(id).then((r) => setVersions(r.versions.slice(0, 8))).catch(() => {});
    studioApi.docs(id).then((r) => setDocs(r.docs)).catch(() => {});
    studioApi.reviews(id).then((r) => setReviews(r.reviews)).catch(() => {});
    studioApi.feedback(id).then((r) => setFeedback(r.feedback)).catch(() => {});
    studioApi.analytics(id).then((r) => setAnalytics(r.analytics)).catch(() => {});
    studioApi.notes(id).then((r) => setNotes(r.notes)).catch(() => {});
    studioApi
      .listProjects()
      .then((r) => setPublished(Boolean(r.projects.find((p) => p.id === id)?.published_version)))
      .catch(() => {});
  }, [id]);

  const cover = useMemo(() => (data ? coverDataOf(data.project) : null), [data]);
  if (error) {
    return (
      <StudioShell>
        <div className="page">
          <div className="notice err">{error}</div>
        </div>
      </StudioShell>
    );
  }
  if (!data || !cover) {
    return (
      <StudioShell>
        <div className="page muted">載入中…</div>
      </StudioShell>
    );
  }
  const p = data.project;
  const list = steps(p, id, check, published);
  const doneCount = list.filter((s) => s.done).length;
  const minutes = check?.quality?.metrics.duration?.typicalMinutes;
  const latest = (target: string) => reviews.find((r) => r.target === target);
  const full = latest("full");
  const revision = projectRevision(p);
  const pipelineInput = {
    hasStory: Boolean(docs.story?.content.trim()),
    hasTreatment: Boolean(docs.treatment?.content.trim()),
    treatmentPassed: latest("treatment") ? latest("treatment")!.passed : null,
    chapters: p.chapters.map((c) => ({ title: c.title, reviewPassed: latest(c.id) ? latest(c.id)!.passed : null })),
    fullPassed: full ? full.passed : null,
    fullStale: Boolean(full?.passed && full.revision !== revision),
    published,
  };
  const command = `/rpg-new ${id}`;

  return (
    <StudioShell title={p.title}>
      <div className="page">
        <PageHeader
          title={p.title}
          subtitle={`第 ${data.version} 版・${p.description}`}
          actions={
            <>
              <Link className="btn" href={`/studio/play/?id=${id}`} target="_blank">
                ▶ 測試遊玩
              </Link>
              <Link className="btn" href={`/studio/edit/?id=${id}`} data-testid="open-editor">
                編輯器
              </Link>
            </>
          }
        />

        <section className="card stack" data-testid="ai-board">
          <h2 style={{ margin: 0 }}>AI 製作進度</h2>
          <Pipeline input={pipelineInput} />
          {!pipelineInput.hasTreatment && (
            <div className="next-step">
              <div className="small muted">交給 AI</div>
              <div className="small">
                在 VS Code 的 Claude Code 輸入下面這行，AI 會讀取這個專案的故事，寫劇本大綱並通過審查後，一章一章製作。第一次使用請先到「AI 協作」完成設定。
              </div>
              <pre className="code-block" data-testid="ai-command">
                {command}
              </pre>
              <button className="btn small" onClick={() => void navigator.clipboard.writeText(command).catch(() => {})}>
                複製指令
              </button>
            </div>
          )}
        </section>

        <div className="overview-grid">
          <div className="stack">
            <section className="card" data-testid="chapter-board">
              <h2>章節</h2>
              {p.chapters.length === 0 ? (
                <div className="small muted">還沒有章節。AI 會在大綱審查通過後，從第 1 章開始一次做一章。</div>
              ) : (
                <table className="version-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>章節</th>
                      <th>自動試玩</th>
                      <th>審查</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.chapters.map((c, i) => {
                      const cr = check?.chapters.find((x) => x.id === c.id);
                      const rv = latest(c.id);
                      return (
                        <tr key={c.id}>
                          <td className="small muted">{i + 1}</td>
                          <td>
                            {c.title}
                            {c.summary && <div className="small muted">{c.summary}</div>}
                          </td>
                          <td className="small">
                            {!check ? "檢查中…" : cr?.ok ? `✓ ${cr.minutes ? `${cr.minutes[0]}～${cr.minutes[1]} 分鐘` : ""}` : <span className="err-text">✗ {cr?.issues[0]?.message.slice(0, 40)}</span>}
                          </td>
                          <td className="small">{rv ? <span className={rv.passed ? "ok-text" : "err-text"}>{rv.passed ? "✓" : "✗"} {rv.overall ?? "-"} 分</span> : <span className="muted">尚未審查</span>}</td>
                          <td>
                            <Link className="btn small" href={`/studio/play/?id=${id}&chapter=${encodeURIComponent(c.id)}`} target="_blank">
                              ▶ 從這章測試
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card" data-testid="review-board">
              <h2>審查紀錄</h2>
              {reviews.length === 0 && <div className="small muted">還沒有審查紀錄。AI 每次審查（大綱、章節、整體）的分數與意見都會出現在這裡。</div>}
              {reviews.slice(0, 12).map((r) => {
                const chapter = p.chapters.find((c) => c.id === r.target);
                return (
                  <details key={r.id} className="review-item">
                    <summary>
                      <span className={`badge ${r.passed ? "ok" : "err"}`}>{r.passed ? "通過" : "退回"}</span> <b>{KIND_LABEL[r.kind]}</b>
                      {chapter ? `：${chapter.title}` : ""}・{r.overall ?? "-"} 分 <span className="small muted">{time(r.created_at)}</span>
                    </summary>
                    <p className="small">{r.data.review.summary}</p>
                    {r.data.review.followUp && r.data.review.followUp.length > 0 && (
                      <div className="small muted">
                        上一輪的問題：已解決 {r.data.review.followUp.filter((f) => f.resolved).length} / {r.data.review.followUp.length}
                      </div>
                    )}
                    {r.data.review.players && (
                      <div className="small">
                        {r.data.review.players.map((x) => (
                          <div key={x.persona}>
                            {x.wouldContinue ? "👍" : "👎"} {PERSONA_LABEL[x.persona]}：{x.reason}
                          </div>
                        ))}
                      </div>
                    )}
                    {r.data.prediction && (
                      <details className="small muted">
                        <summary>盲猜測試：只看開頭的老玩家這樣猜</summary>
                        {r.data.prediction.guesses.map((g, i) => (
                          <div key={i}>
                            {g.about}：{g.guess}
                          </div>
                        ))}
                        {r.data.prediction.feelsLike.length > 0 && <div>覺得像：{r.data.prediction.feelsLike.join("、")}</div>}
                      </details>
                    )}
                    <div className="score-grid">
                      {Object.entries(r.data.review.scores).map(([k, v]) => (
                        <span key={k} className={v < 6 ? "err-text" : v >= 8 ? "ok-text" : ""}>
                          {SCORE_LABEL[k] ?? k} {v}
                        </span>
                      ))}
                    </div>
                    {r.data.review.issues.map((x, i) => (
                      <div key={i} className={`issue ${x.severity === "minor" ? "warn" : "err"}`}>
                        <div>
                          [{x.severity}] {x.problem}
                        </div>
                        <div className="path">建議：{x.suggestion}</div>
                      </div>
                    ))}
                  </details>
                );
              })}
            </section>

            <section className="card" data-testid="notes-board">
              <h2>
                修改清單 <span className="badge">{notes.filter((n) => n.status === "open").length} 筆待處理</span>
              </h2>
              {notes.length === 0 ? (
                <div className="small muted">
                  測試遊玩時看到要改的地方，按右上角的「📌 標記修改」寫一句意見。系統會附上位置代碼、當下的台詞與開關狀態，AI 執行 <code>npm run game -- remote notes {id}</code> 就能直接找到那裡修改，改完標成已處理。
                </div>
              ) : (
                notes.slice(0, 30).map((n) => (
                  <div key={n.id} className={`issue ${n.status === "open" ? "warn" : ""}`} data-testid="note-item">
                    <div>
                      <span className={`badge ${n.status === "open" ? "err" : "ok"}`}>{n.status === "open" ? "待處理" : n.status === "resolved" ? "已處理" : "不處理"}</span> {n.body}
                    </div>
                    <div className="path">
                      {n.locator ?? `${n.map_id} (${n.x},${n.y})`}
                      {n.excerpt ? `・「${n.excerpt.split("\n")[0].slice(0, 40)}」` : ""}・{n.author}・{time(n.created_at)}
                    </div>
                    {n.resolution && (
                      <div className="small muted">
                        處理方式（{n.resolved_by}）：{n.resolution}
                      </div>
                    )}
                    <button
                      className="btn small"
                      onClick={async () => {
                        const next = n.status === "open" ? "resolved" : "open";
                        const resolution = next === "resolved" ? (window.prompt("怎麼處理的？（選填）") ?? "") : "";
                        await studioApi.updateNote(id, n.id, next, resolution).catch(() => {});
                        setNotes((list) => list.map((x) => (x.id === n.id ? { ...x, status: next, resolution: resolution || null } : x)));
                      }}
                    >
                      {n.status === "open" ? "標成已處理" : "重新打開"}
                    </button>
                  </div>
                ))
              )}
            </section>

            <section className="card" data-testid="analytics-board">
              <h2>遊玩數據</h2>
              {!analytics?.visitors ? (
                <div className="small muted">還沒有遊玩數據。玩家在玩家網站遊玩時，會匿名記錄開始、章節進度、結局與離開的位置（不保存 IP；沒有網路時不記錄，也不影響遊玩）。</div>
              ) : (
                <>
                  <div className="small">
                    👤 {analytics.visitors} 位玩家・{analytics.sessions} 次遊玩
                    {analytics.minutes ? `・累計約 ${Math.round(analytics.minutes)} 分鐘` : ""}
                    {analytics.daily.length > 0 && <span className="muted">・近 14 天：{analytics.daily.map((d) => `${d.day.slice(5)} ${d.visitors}人`).join("、")}</span>}
                  </div>
                  <table className="version-table">
                    <tbody>
                      {p.chapters.map((c, i) => {
                        const row = analytics.chapters.find((x) => x.chapter_id === c.id);
                        return (
                          <tr key={c.id}>
                            <td className="small">
                              第 {i + 1} 章 {c.title}
                            </td>
                            <td className="small">{row ? `完成 ${row.done} / 進入 ${row.entered}（${row.entered ? Math.round((row.done / row.entered) * 100) : 0}%）` : "—"}</td>
                            <td className="small muted">{row?.minutes ? `平均 ${row.minutes.toFixed(0)} 分鐘` : ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {analytics.endings.length > 0 && (
                    <div className="small" style={{ marginTop: 8 }}>
                      🏁 結局：{analytics.endings.map((e) => `${p.endings.find((x) => x.id === e.ref)?.title ?? e.ref} ${e.players} 人`).join("、")}
                    </div>
                  )}
                  {analytics.quits.length > 0 && (
                    <div className="small muted" style={{ marginTop: 4 }}>
                      🚪 最常離開的地方（還沒破關）：
                      {analytics.quits
                        .slice(0, 5)
                        .map((q) => `${p.chapters.find((c) => c.id === q.chapter_id)?.title ?? q.chapter_id ?? "?"}・${p.maps.find((m) => m.id === q.ref)?.name ?? q.ref ?? "?"} ${q.players} 人`)
                        .join("、")}
                    </div>
                  )}
                </>
              )}
            </section>

            <section className="card" data-testid="feedback-board">
              <h2>玩家回饋</h2>
              {feedback.length === 0 ? (
                <div className="small muted">還沒有玩家回饋。玩家在玩家網站玩完一章時，會被邀請留下星等、標籤與一句話；這些回饋也會彙整進 AI 案例庫。</div>
              ) : (
                <>
                  <table className="version-table">
                    <tbody>
                      {[...new Set(feedback.map((f) => f.chapter_id))].map((cid) => {
                        const list = feedback.filter((f) => f.chapter_id === cid);
                        const tags = new Map<string, number>();
                        list.forEach((f) => f.tags.forEach((t) => tags.set(t, (tags.get(t) ?? 0) + 1)));
                        return (
                          <tr key={cid}>
                            <td className="small">{p.chapters.find((c) => c.id === cid)?.title ?? cid}</td>
                            <td className="small">
                              ★ {(list.reduce((n, f) => n + f.rating, 0) / list.length).toFixed(1)}（{list.length} 則）
                            </td>
                            <td className="small muted">
                              {[...tags]
                                .sort((a, b) => b[1] - a[1])
                                .slice(0, 4)
                                .map(([t, n]) => `${t}×${n}`)
                                .join("、")}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {feedback
                    .filter((f) => f.comment.trim())
                    .slice(0, 8)
                    .map((f, i) => (
                      <div key={i} className="version-line small">
                        <span className="badge">{"★".repeat(f.rating)}</span> {f.comment}
                      </div>
                    ))}
                </>
              )}
            </section>

            <details className="card" data-testid="checklist">
              <summary>
                <b>手動製作清單</b> <span className="badge ok">{doneCount} / {list.length}</span>
                <span className="small muted">（自己動手修改時的參考）</span>
              </summary>
              <div className="steps" style={{ marginTop: 10 }}>
                {list.map((s) => (
                  <div key={s.title} className={`step${s.done ? " done" : ""}`}>
                    <span className="step-mark">{s.done ? "✓" : "○"}</span>
                    <div className="grow">
                      <div>{s.title}</div>
                      {!s.done && <div className="small muted">{s.how}</div>}
                    </div>
                    <Link className="btn small" href={s.href}>
                      {s.cta}
                    </Link>
                  </div>
                ))}
              </div>
            </details>
          </div>

          <div className="stack">
            <section className="card">
              <div className="overview-cover">
                <CoverArt cover={cover} />
                <div className="game-card-title">{p.title}</div>
              </div>
            </section>
            <section className="card">
              <h2>規模</h2>
              <div className="stat-grid">
                <div><b>{p.maps.length}</b><span>地圖</span></div>
                <div><b>{p.maps.reduce((n, m) => n + m.events.length, 0)}</b><span>事件</span></div>
                <div><b>{p.actors.length}</b><span>角色</span></div>
                <div><b>{p.chapters.length}</b><span>章節</span></div>
                <div><b>{p.quests.length}</b><span>任務</span></div>
                <div><b>{p.endings.length}</b><span>結局</span></div>
              </div>
              <div className="small muted" style={{ marginTop: 8 }}>
                預估遊玩時間：{minutes ? `${minutes[0]}～${minutes[1]} 分鐘` : check ? "需要先通過驗證才能估算" : "在你的瀏覽器計算中…"}（目標 60～120 分鐘）
              </div>
            </section>
            {check && check.validation.errors.length > 0 && (
              <section className="card">
                <h2>待修正（{check.validation.errors.length}）</h2>
                <IssueList errors={check.validation.errors.slice(0, 6)} warnings={[]} />
              </section>
            )}
            {check?.quality && check.quality.blocking.length > 0 && (
              <section className="card">
                <h2>品質指標未達標（{check.quality.blocking.length}）</h2>
                <IssueList errors={check.quality.blocking.slice(0, 6)} warnings={[]} />
              </section>
            )}
            <section className="card stack" data-testid="story-doc">
              <div className="row">
                <h2 className="grow" style={{ margin: 0 }}>
                  故事
                </h2>
                {storyDraft === null ? (
                  <button className="btn small" onClick={() => setStoryDraft(docs.story?.content ?? "")}>
                    編輯
                  </button>
                ) : (
                  <button
                    className="btn small primary"
                    onClick={async () => {
                      await studioApi.saveDoc(id, "story", storyDraft);
                      setDocs({ ...docs, story: { kind: "story", content: storyDraft, updated_at: new Date().toISOString(), updated_by: "你" } });
                      setStoryDraft(null);
                    }}
                  >
                    儲存
                  </button>
                )}
              </div>
              {storyDraft !== null ? (
                <textarea rows={8} value={storyDraft} onChange={(e) => setStoryDraft(e.target.value)} />
              ) : docs.story ? (
                <div className="doc-text small">{docs.story.content}</div>
              ) : (
                <div className="small muted">還沒有故事。按「編輯」寫下故事或題材，AI 會從這裡讀取。</div>
              )}
            </section>
            <details className="card" data-testid="treatment-doc">
              <summary>
                <b>劇本大綱</b> {docs.treatment && <span className="small muted">（{docs.treatment.updated_by}・{time(docs.treatment.updated_at)}）</span>}
              </summary>
              {docs.treatment ? <div className="doc-text small">{docs.treatment.content}</div> : <div className="small muted">AI 寫好大綱並送審時，會出現在這裡。</div>}
            </details>
            <section className="card">
              <div className="row">
                <h2 className="grow" style={{ margin: 0 }}>
                  最近的修改
                </h2>
                <Link className="small" href={`/studio/versions/?id=${id}`}>
                  全部 →
                </Link>
              </div>
              {versions.map((v) => (
                <div key={v.version} className="version-line small">
                  <span className="badge">v{v.version}</span> <span className={v.actor.includes("API Token") ? "actor-ai" : "actor-human"}>{v.actor.includes("API Token") ? "🤖" : "👤"} {v.actor}</span>
                  <div className="muted">{v.label}</div>
                </div>
              ))}
            </section>
          </div>
        </div>
      </div>
    </StudioShell>
  );
}
