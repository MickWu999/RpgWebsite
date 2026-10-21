"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import IssueList from "@/components/IssueList";
import { projectRevision } from "@/game/engine";
import type { GameProject } from "@/game/schema";
import { PLAYER_SITE_URL, studioApi, type CheckResult, type ReviewEntry } from "@/lib/studioApi";
import { runCheckAsync } from "@/studio/checkClient";
import StudioShell, { PageHeader } from "../StudioShell";

/** 發布：逐項顯示檢查結果，通過後發布到玩家網站（玩家網址只顯示成文字，前後台不互相連結） */
export default function PublishPage() {
  const id = useSearchParams().get("id") ?? "";
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [state, setState] = useState<{ published: boolean; version?: number | null }>({ published: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "err"; text: string } | null>(null);
  const [allowQuality, setAllowQuality] = useState(false);
  const [updateKind, setUpdateKind] = useState<"update" | "fix">("update");
  const [updateText, setUpdateText] = useState("");
  const [project, setProject] = useState<GameProject | null>(null);
  const [reviews, setReviews] = useState<ReviewEntry[]>([]);

  const load = () => {
    studioApi.reviews(id).then((r) => setReviews(r.reviews)).catch(() => {});
    studioApi
      .getProject(id)
      .then((r) => {
        setProject(r.project);
        return runCheckAsync(r.project);
      })
      .then(setCheck)
      .catch((e: Error) => setMessage({ kind: "err", text: e.message }));
    studioApi.listProjects().then((r) => {
      const p = r.projects.find((x) => x.id === id);
      setState({ published: Boolean(p?.published_version), version: p?.published_version });
    });
  };
  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const items = check
    ? [
        { ok: check.validation.errors.length === 0, label: "資料驗證", detail: check.validation.errors.length ? `${check.validation.errors.length} 個錯誤` : "引用、地圖、對話、任務都正確" },
        { ok: Boolean(check.playtest?.ok), label: "自動試玩", detail: check.playtest ? check.playtest.endings.map((e) => `${e.reachable ? "✓" : "✗"} ${e.title}`).join("　") : "需要先通過資料驗證" },
        { ok: (check.quality?.blocking.length ?? 1) === 0, label: "品質指標", detail: check.quality ? (check.quality.blocking.length ? `${check.quality.blocking.length} 項未達標` : "規模、時長、章節、敘事指標都達標") : "需要先通過資料驗證" },
      ]
    : [];
  // 審查關卡：大綱、每一章、整體（針對目前版本）；與伺服器的判斷相同
  const latest = (target: string) => reviews.find((r) => r.target === target);
  const reviewItems = project
    ? [
        { ok: Boolean(latest("treatment")?.passed), label: "劇本大綱審查", detail: latest("treatment") ? `${latest("treatment")!.overall ?? "-"} 分` : "尚未審查" },
        ...project.chapters.map((c, i) => ({ ok: Boolean(latest(c.id)?.passed), label: `第 ${i + 1} 章審查：${c.title}`, detail: latest(c.id) ? `${latest(c.id)!.overall ?? "-"} 分` : "尚未審查" })),
        project.release?.status === "ongoing"
          ? { ok: true, label: "整體審查", detail: "連載中：完結時再進行整體審查" }
          : {
              ok: Boolean(latest("full")?.passed && latest("full")!.revision === projectRevision(project)),
              label: "整體審查",
              detail: !latest("full") ? "尚未審查" : latest("full")!.revision !== projectRevision(project) ? "審查後內容又改過，需要重新審查" : `${latest("full")!.overall ?? "-"} 分`,
            },
      ]
    : [];
  const reviewsOk = reviewItems.every((r) => r.ok);
  const needOverride = (check?.quality?.blocking.length ?? 0) > 0 || !reviewsOk;
  const canPublish = Boolean(check?.playtest?.ok) && (!needOverride || allowQuality);

  return (
    <StudioShell>
      <div className="page">
        <PageHeader title="發布" subtitle="發布後，玩家網站的遊戲選單會立即出現這款遊戲。之後再發布會更新成最新版本。" />
        {message && <div className={`notice ${message.kind}`}>{message.text}</div>}
        <div className="card stack" data-testid="publish-checks">
          <h2>發布前檢查</h2>
          {!check && <div className="muted">在你的瀏覽器檢查中…（驗證＋把每個結局自動玩過一遍）</div>}
          {items.map((it) => (
            <div key={it.label} className={`step${it.ok ? " done" : ""}`}>
              <span className="step-mark">{it.ok ? "✓" : "✗"}</span>
              <div className="grow">
                <div>{it.label}</div>
                <div className="small muted">{it.detail}</div>
              </div>
            </div>
          ))}
          {reviewItems.map((it) => (
            <div key={it.label} className={`step${it.ok ? " done" : ""}`}>
              <span className="step-mark">{it.ok ? "✓" : "✗"}</span>
              <div className="grow">
                <div>{it.label}</div>
                <div className="small muted">{it.detail}</div>
              </div>
            </div>
          ))}
          {check && <IssueList errors={[...check.validation.errors, ...(check.playtest?.issues ?? []), ...(check.quality?.blocking ?? [])].slice(0, 12)} warnings={check.quality?.suggestions ?? []} />}
          {needOverride && check?.playtest?.ok && (
            <label className="small">
              <input type="checkbox" checked={allowQuality} onChange={(e) => setAllowQuality(e.target.checked)} /> 我了解品質指標或審查尚未全部通過，仍要以人工判斷發布（AI 透過 API Token 無法略過這些關卡）
            </label>
          )}
          {state.published && (
            <div className="row">
              <select value={updateKind} onChange={(e) => setUpdateKind(e.target.value as "update" | "fix")} aria-label="更新類型">
                <option value="update">✨ 更新</option>
                <option value="fix">🔧 修正</option>
              </select>
              <input className="grow" value={updateText} maxLength={200} onChange={(e) => setUpdateText(e.target.value)} placeholder="給玩家的更新說明（選填；有填才會通知玩家）" data-testid="publish-update-text" />
            </div>
          )}
          <div className="small muted">通知會自動發出：第一次發布 → 🎮 新遊戲推出；章節變多 → 📖 新章節上線；填了更新說明 → ✨ 更新／🔧 修正。只改錯字之類的小地方不用填，就不會打擾玩家。</div>
          <div className="row">
            <button
              className="btn"
              onClick={() => {
                setCheck(null);
                load();
              }}
            >
              重新檢查
            </button>
            <button
              className="btn primary"
              disabled={!canPublish || busy}
              data-testid="publish-button"
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await studioApi.publish(id, check!, allowQuality, updateText.trim() ? { kind: updateKind, text: updateText.trim() } : undefined);
                  setMessage({ kind: "info", text: `已發布第 ${r.version} 版${r.notice ? `，並通知玩家：${r.notice.title}` : "（這次沒有通知玩家）"}` });
                  setUpdateText("");
                  load();
                } catch (e) {
                  setMessage({ kind: "err", text: (e as Error).message });
                } finally {
                  setBusy(false);
                }
              }}
            >
              🚀 {state.published ? "更新發布" : "發布"}
            </button>
            {state.published && (
              <button
                className="btn danger"
                onClick={async () => {
                  if (!window.confirm("確定要從玩家網站下架？玩家的存檔不會被刪除。")) return;
                  await studioApi.unpublish(id);
                  load();
                }}
              >
                下架
              </button>
            )}
          </div>
        </div>
        <div className="card stack">
          <h2>發布狀態</h2>
          {state.published ? (
            <>
              <div>
                <span className="badge ok">已發布 v{state.version}</span>
              </div>
              <div className="small">玩家網址（請複製後在瀏覽器開啟）：</div>
              <code className="copyable" data-testid="player-url">
                {PLAYER_SITE_URL}/play/?pack={id}
              </code>
            </>
          ) : (
            <div className="muted small">尚未發布。</div>
          )}
        </div>
      </div>
    </StudioShell>
  );
}
