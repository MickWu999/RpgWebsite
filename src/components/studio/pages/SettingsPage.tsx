"use client";

import Link from "next/link";
import { useState } from "react";
import { studioApi } from "@/lib/studioApi";
import StudioShell, { PageHeader } from "../StudioShell";

/** 設定：修改密碼（登入紀錄在「系統管理 → 登入紀錄」） */
export default function SettingsPage() {
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
        <section className="card stack" style={{ maxWidth: 480 }}>
          <h2>登入紀錄</h2>
          <div className="small muted">每次登入 Studio 的時間、IP、地區與裝置，在「系統管理 → 登入紀錄」。</div>
          <Link className="btn small" href="/studio/logins/">
            查看登入紀錄
          </Link>
        </section>
      </div>
    </StudioShell>
  );
}
