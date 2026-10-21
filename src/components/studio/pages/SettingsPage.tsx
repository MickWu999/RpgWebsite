"use client";

import { useEffect, useState } from "react";
import { studioApi } from "@/lib/studioApi";
import StudioShell, { PageHeader } from "../StudioShell";

type LoginRow = Awaited<ReturnType<typeof studioApi.logins>>["logins"][number];

/** 設定：修改密碼、後台登入紀錄 */
export default function SettingsPage() {
  const [logins, setLogins] = useState<LoginRow[] | null>(null);
  useEffect(() => {
    studioApi
      .logins()
      .then((r) => setLogins(r.logins))
      .catch(() => setLogins([]));
  }, []);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [message, setMessage] = useState<{ kind: "info" | "err"; text: string } | null>(null);
  return (
    <StudioShell>
      <div className="page">
        <PageHeader title="設定" subtitle="帳號與安全性" />
        <form
          className="card stack"
          style={{ maxWidth: 480 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (next !== confirm) return setMessage({ kind: "err", text: "兩次輸入的新密碼不一致" });
            try {
              const r = await studioApi.changePassword(current, next);
              setMessage({ kind: "info", text: r.notice });
              setTimeout(() => (window.location.href = "/studio/login/"), 1500);
            } catch (err) {
              setMessage({ kind: "err", text: (err as Error).message });
            }
          }}
        >
          <h2>修改密碼</h2>
          <label className="field">
            目前的密碼
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
          <label className="field">
            新密碼（至少 6 個字元）
            <input type="password" autoComplete="new-password" minLength={6} value={next} onChange={(e) => setNext(e.target.value)} required />
          </label>
          <label className="field">
            再輸入一次新密碼
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          {message && <div className={`notice ${message.kind} small`}>{message.text}</div>}
          <button className="btn primary" type="submit">
            更新密碼
          </button>
          <p className="small muted">更新後，所有裝置都需要重新登入。API Token 不受影響（如有疑慮請到「AI 協作」撤銷）。</p>
        </form>
        <section className="card stack" data-testid="login-log">
          <h2>登入紀錄</h2>
          <div className="small muted">最近 100 次登入 Studio 的紀錄（保留 90 天）。看到不認識的 IP、地區，或失敗次數異常，請立刻修改密碼。</div>
          {!logins ? (
            <div className="small muted">載入中…</div>
          ) : logins.length === 0 ? (
            <div className="small muted">還沒有紀錄。</div>
          ) : (
            <table className="version-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>帳號（操作者）</th>
                  <th>IP</th>
                  <th>地區</th>
                  <th>裝置</th>
                  <th>結果</th>
                </tr>
              </thead>
              <tbody>
                {logins.map((l, i) => (
                  <tr key={i}>
                    <td className="small">{new Date(l.created_at).toLocaleString("zh-TW", { hour12: false })}</td>
                    <td className="small">
                      {l.username}
                      {l.operator ? `（${l.operator}）` : ""}
                    </td>
                    <td className="small">
                      <code>{l.ip}</code>
                    </td>
                    <td className="small">{l.country ?? "-"}</td>
                    <td className="small">{l.device}</td>
                    <td className="small">{l.success ? <span className="badge ok">成功</span> : <span className="badge err">失敗</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </StudioShell>
  );
}
