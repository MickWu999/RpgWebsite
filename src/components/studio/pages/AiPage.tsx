"use client";

import { useEffect, useState } from "react";
import { studioApi, type TokenEntry } from "@/lib/studioApi";
import StudioShell, { PageHeader } from "../StudioShell";

/** AI 協作：產生／撤銷 API Token，並提供讓 VS Code 裡的 AI agent 接上 Studio 的設定範例 */
export default function AiPage() {
  const [tokens, setTokens] = useState<TokenEntry[]>([]);
  const [name, setName] = useState("VS Code Claude Code");
  const [created, setCreated] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const load = () => studioApi.listTokens().then((r) => setTokens(r.tokens));
  useEffect(() => {
    void load();
    const frame = requestAnimationFrame(() => setOrigin(window.location.origin));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <StudioShell>
      <div className="page">
        <PageHeader title="AI 協作" subtitle="產生 API Token 交給你的 AI agent（例如 VS Code 裡的 Claude Code），它就能用和你相同的操作來製作、檢查、發布遊戲。所有 AI 的修改都會出現在版本紀錄中。" />
        <div className="card stack">
          <h2>1. 產生 API Token</h2>
          <div className="row">
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="用途（例如：VS Code Claude Code）" style={{ maxWidth: 360 }} />
            <button
              className="btn primary"
              data-testid="create-token"
              onClick={async () => {
                const r = await studioApi.createToken(name);
                setCreated(r.token);
                void load();
              }}
            >
              產生 Token
            </button>
          </div>
          {created && (
            <div className="notice" data-testid="new-token">
              <b>請立刻複製保存，這是唯一一次顯示完整 token：</b>
              <code className="copyable">{created}</code>
            </div>
          )}
          <table className="version-table">
            <thead>
              <tr>
                <th>名稱</th>
                <th>開頭</th>
                <th>建立</th>
                <th>最後使用</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.name}</td>
                  <td className="mono small">{t.token_prefix}…</td>
                  <td className="small muted">{new Date(t.created_at).toLocaleString("zh-TW", { hour12: false })}</td>
                  <td className="small muted">{t.last_used_at ? new Date(t.last_used_at).toLocaleString("zh-TW", { hour12: false }) : "尚未使用"}</td>
                  <td>
                    {t.revoked_at ? (
                      <span className="badge">已撤銷</span>
                    ) : (
                      <button
                        className="btn small danger"
                        onClick={async () => {
                          if (!window.confirm(`撤銷「${t.name}」？使用這個 token 的 AI 會立即無法操作。`)) return;
                          await studioApi.revokeToken(t.id);
                          void load();
                        }}
                      >
                        撤銷
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card stack">
          <h2>2. 讓 AI agent 接上 Studio</h2>
          <p className="small">在遊戲專案的 repo 裡建立 <code>.env.local</code>（不要提交到 git）：</p>
          <pre className="code-block">{`STUDIO_URL=${origin}\nSTUDIO_TOKEN=<上面產生的 token>`}</pre>
          <p className="small">然後在 VS Code 的 Claude Code 輸入，例如：</p>
          <pre className="code-block">{`/rpg-new 一個關於新兵在懇親會前想挽回家人信任的故事`}</pre>
          <p className="small">AI 會用下列遠端指令操作這個 Studio（也可以直接呼叫 REST API，說明見 {origin}/api/docs）：</p>
          <pre className="code-block">{`npm run game -- remote list
npm run game -- remote pull <專案ID>          # 下載到 content/<ID>/project.json
npm run game -- remote apply <專案ID> ops.json # 送出操作（帶版本號，避免覆蓋你的修改）
npm run game -- remote check <專案ID>
npm run game -- remote publish <專案ID>`}</pre>
          <p className="small muted">AI 的每次修改都會留下版本紀錄（🤖），你可以隨時在「版本紀錄」還原。API Token 不能刪除專案、不能管理其他 token、也不能略過品質指標發布。</p>
        </div>
      </div>
    </StudioShell>
  );
}
