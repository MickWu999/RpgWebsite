"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { studioApi } from "@/lib/studioApi";

/** Studio 登入頁 */
export default function LoginPage() {
  const next = useSearchParams().get("next") ?? "/studio/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(true);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await studioApi.login(username, password, remember);
      window.location.href = next.startsWith("/studio") ? next : "/studio/";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit} data-testid="login-form">
        <div className="login-brand">
          <span className="shell-logo">◆</span> AI RPG <b>Studio</b>
        </div>
        <p className="muted small">開發者登入。帳號由管理員建立（npm run studio:user -- add &lt;帳號&gt;）。</p>
        <label className="field">
          帳號
          <input type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label className="field">
          密碼
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <label className="small">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 保持登入（30 天內自動登入）
        </label>
        {error && <div className="notice err small">{error}</div>}
        <button className="btn primary" disabled={busy} type="submit">
          {busy ? "登入中…" : "登入"}
        </button>
      </form>
    </div>
  );
}
