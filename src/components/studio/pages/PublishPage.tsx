"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import IssueList from "@/components/IssueList";
import { PLAYER_SITE_URL, studioApi, type CheckResult } from "@/lib/studioApi";
import StudioShell, { PageHeader } from "../StudioShell";

/** 發布：逐項顯示檢查結果，通過後發布到玩家網站（玩家網址只顯示成文字，前後台不互相連結） */
export default function PublishPage() {
  const id = useSearchParams().get("id") ?? "";
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [state, setState] = useState<{ published: boolean; version?: number | null }>({ published: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "err"; text: string } | null>(null);
  const [allowQuality, setAllowQuality] = useState(false);

  const load = () => {
    studioApi.check(id).then(setCheck).catch((e: Error) => setMessage({ kind: "err", text: e.message }));
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
        { ok: (check.quality?.blocking.length ?? 1) === 0, label: "品質指標", detail: check.quality ? (check.quality.blocking.length ? `${check.quality.blocking.length} 項未達標` : "規模、時長、敘事指標都達標") : "需要先通過資料驗證" },
      ]
    : [];
  const canPublish = Boolean(check?.playtest?.ok) && (check?.quality?.blocking.length === 0 || allowQuality);

  return (
    <StudioShell>
      <div className="page">
        <PageHeader title="發布" subtitle="發布後，玩家網站的遊戲選單會立即出現這款遊戲。之後再發布會更新成最新版本。" />
        {message && <div className={`notice ${message.kind}`}>{message.text}</div>}
        <div className="card stack" data-testid="publish-checks">
          <h2>發布前檢查</h2>
          {!check && <div className="muted">檢查中…（驗證＋把每個結局自動玩過一遍）</div>}
          {items.map((it) => (
            <div key={it.label} className={`step${it.ok ? " done" : ""}`}>
              <span className="step-mark">{it.ok ? "✓" : "✗"}</span>
              <div className="grow">
                <div>{it.label}</div>
                <div className="small muted">{it.detail}</div>
              </div>
            </div>
          ))}
          {check && <IssueList errors={[...check.validation.errors, ...(check.playtest?.issues ?? []), ...(check.quality?.blocking ?? [])].slice(0, 12)} warnings={check.quality?.suggestions ?? []} />}
          {check?.quality && check.quality.blocking.length > 0 && check.playtest?.ok && (
            <label className="small">
              <input type="checkbox" checked={allowQuality} onChange={(e) => setAllowQuality(e.target.checked)} /> 我了解品質指標未達標（例如時長不足），仍要以人工判斷發布（AI 透過 API Token 無法略過這一項）
            </label>
          )}
          <div className="row">
            <button className="btn" onClick={load}>
              重新檢查
            </button>
            <button
              className="btn primary"
              disabled={!canPublish || busy}
              data-testid="publish-button"
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await studioApi.publish(id, allowQuality);
                  setMessage({ kind: "info", text: `已發布第 ${r.version} 版` });
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
