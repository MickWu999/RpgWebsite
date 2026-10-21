"use client";

import { useEffect, useState } from "react";
import { studioApi, type TokenEntry } from "@/lib/studioApi";
import Link from "next/link";
import StudioShell, { PageHeader } from "../StudioShell";
import { HelpContent } from "./HelpPage";
import RulesContent from "./RulesContent";

/**
 * AI 協作：說明「你 → VS Code 的 AI agent → Studio」的流程，並引導完成設定（產生 Token、設定 .env.local、下指令）。
 * 步驟會依實際狀態打勾：有有效 Token → 已產生；Token 被使用過 → AI 已連線。
 */

const REPO = "https://github.com/MickWu999/RpgWebsite.git";
const EXAMPLE_OPS = `[
  { "op": "actor.upsert", "actor": { "id": "sergeant", "name": "王班長", "spriteAssetId": "char_knight",
      "voice": { "pitch": "low", "speed": "fast", "timbre": "buzzy" } } },
  { "op": "event.upsert", "mapId": "barracks", "event": { "id": "sergeant", "name": "王班長", "x": 5, "y": 3,
      "pages": [{ "trigger": "action", "priority": "same", "graphic": { "assetId": "char_knight" },
        "commands": [
          { "code": "text", "actorId": "sergeant", "text": "菜鳥，棉被摺成這樣，你媽來懇親會看到會哭喔。" },
          { "code": "switch", "ids": ["met_sergeant"], "value": true }
        ] }] } }
]`;

function CopyBlock({ text, testId }: { text: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <pre className="code-block" data-testid={testId}>
        {text}
      </pre>
      <button
        className="btn small copy-btn"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // 無法存取剪貼簿時使用者仍可手動選取
          }
        }}
      >
        {copied ? "已複製 ✓" : "複製"}
      </button>
    </div>
  );
}

export default function AiPage({ tab = "ai" }: { tab?: "ai" | "help" | "rules" }) {
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

  const active = tokens.filter((t) => !t.revoked_at);
  const connected = active.filter((t) => t.last_used_at).sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""));
  const hasToken = active.length > 0;
  const isConnected = connected.length > 0;
  const doneCount = [hasToken, isConnected, isConnected].filter(Boolean).length;
  const envText = `STUDIO_URL=${origin}\nSTUDIO_TOKEN=${created ?? "<在步驟 1 產生的 token>"}`;

  return (
    <StudioShell>
      <div className="page">
        <PageHeader
          title="AI 協作"
          subtitle="讓你在 VS Code 裡使用的 AI agent（Claude Code）直接操作這個 Studio：寫大綱、畫地圖、放 NPC、寫對話、檢查、發布。不需要任何雲端 API key，AI 的費用由你自己的 Claude Code 帳號負擔。"
        />

        <div className="tabs" role="tablist">
          <Link href="/studio/ai/" className={`tab${tab === "ai" ? " active" : ""}`}>
            🤖 AI 協作
          </Link>
          <Link href="/studio/rules/" className={`tab${tab === "rules" ? " active" : ""}`} data-testid="tab-rules">
            ⚖ 審查規則
          </Link>
          <Link href="/studio/help/" className={`tab${tab === "help" ? " active" : ""}`} data-testid="tab-help">
            ❓ 使用說明
          </Link>
        </div>
        {tab === "help" ? (
          <HelpContent />
        ) : tab === "rules" ? (
          <RulesContent />
        ) : (
          <>
        <section className="card stack" data-testid="ai-flow">
          <h2>運作方式</h2>
          <div className="ai-flow">
            <div className="ai-node">
              <div className="ai-node-icon">👤</div>
              <b>你</b>
              <span className="small muted">用一句話描述想做的遊戲</span>
            </div>
            <div className="ai-arrow">
              <span>① 下指令</span>
              <span className="ai-arrow-line">→</span>
              <span className="muted">⑤ 回報結果</span>
            </div>
            <div className="ai-node">
              <div className="ai-node-icon">🤖</div>
              <b>VS Code 的 Claude Code</b>
              <span className="small muted">讀開發規範 → 寫大綱 → 一章一章製作 → 自己檢查與修正</span>
            </div>
            <div className="ai-arrow">
              <span>② 帶 Token 送出操作</span>
              <span className="ai-arrow-line">→</span>
              <span className="muted">③ 回傳結果</span>
            </div>
            <div className="ai-node">
              <div className="ai-node-icon">🗺</div>
              <b>Studio（這裡）</b>
              <span className="small muted">雲端專案、版本紀錄、發布</span>
            </div>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            ④ 製作過程中你隨時可以打開專案：編輯器會即時跳出「🤖 已更新」，版本紀錄看得到 AI 的每一步；不滿意可以直接手動修改或還原。人和 AI 改的是同一份資料、用的是同一套操作。
          </p>
        </section>

        <section className="card stack" data-testid="ai-steps">
          <div className="row">
            <h2 className="grow" style={{ margin: 0 }}>
              設定步驟（第一次使用才需要）
            </h2>
            <span className="badge ok">{doneCount} / 3 完成</span>
          </div>

          <div className={`step align-top${hasToken ? " done" : ""}`}>
            <span className="step-mark">{hasToken ? "✓" : "1"}</span>
            <div className="grow stack" style={{ gap: 8 }}>
              <div>
                <b>產生 API Token</b>
                <div className="small muted">Token 是讓 AI 操作 Studio 的鑰匙。完整內容只顯示一次，請立刻複製。</div>
              </div>
              <div className="row">
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="用途（例如：VS Code Claude Code）" style={{ maxWidth: 320 }} />
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
                  <b>請立刻複製保存，這是唯一一次顯示完整 token（步驟 2 的設定內容已自動帶入）：</b>
                  <code className="copyable">{created}</code>
                </div>
              )}
            </div>
          </div>

          <div className={`step align-top${isConnected ? " done" : ""}`}>
            <span className="step-mark">{isConnected ? "✓" : "2"}</span>
            <div className="grow stack" style={{ gap: 8 }}>
              <div>
                <b>在 VS Code 打開專案，並設定 .env.local</b>
                <div className="small muted">專案裡已經寫好給 AI 的規範（CLAUDE.md、docs/ai-development-spec.md）與工具（npm run game），AI 一打開就知道該怎麼做。</div>
              </div>
              <div className="small">在終端機執行：</div>
              <CopyBlock text={`git clone ${REPO}\ncd RpgWebsite\nnpm install\ncode .`} />
              <div className="small">
                在專案資料夾建立 <code>.env.local</code>（已列入 .gitignore，不會被提交）：
              </div>
              <CopyBlock text={envText} testId="env-block" />
            </div>
          </div>

          <div className={`step align-top${isConnected ? " done" : ""}`}>
            <span className="step-mark">{isConnected ? "✓" : "3"}</span>
            <div className="grow stack" style={{ gap: 8 }}>
              <div>
                <b>確認 AI 已連線</b>
                <div className="small muted">請 Claude Code 執行下面這行。成功後重新整理本頁，這一步會自動打勾。</div>
              </div>
              <CopyBlock text="npm run game -- remote list" />
              {connected[0]?.last_used_at && (
                <div className="small" style={{ color: "var(--accent-2)" }} data-testid="connected">
                  ✓ 「{connected[0].name}」最後使用於 {new Date(connected[0].last_used_at).toLocaleString("zh-TW", { hour12: false })}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="card stack" data-testid="ai-commands">
          <h2>開始製作：在 Claude Code 對話框下指令</h2>
          <div className="small muted">用一句話或一段故事描述就好；也可以先在「專案 → ＋ 交給 AI 一個故事」寫好故事，再把專案 ID 交給 AI。</div>
          <CopyBlock text="/rpg-new 一個新兵在懇親會前，想挽回和爸爸關係的溫馨故事" />
          <table className="version-table">
            <tbody>
              <tr>
                <td className="mono small">/rpg-new &lt;故事或專案 ID&gt;</td>
                <td className="small">從零做一款新遊戲（目標 1～2 小時，一章一章製作）</td>
              </tr>
              <tr>
                <td className="mono small">/rpg-expand &lt;專案ID&gt; &lt;內容&gt;</td>
                <td className="small">擴充既有遊戲（只新增，不破壞玩家存檔）</td>
              </tr>
              <tr>
                <td className="mono small">/rpg-review &lt;專案ID&gt;</td>
                <td className="small">只做檢查與審查，回報修改建議</td>
              </tr>
            </tbody>
          </table>
          <h2 style={{ marginTop: 8 }}>AI 會依序做這些事（每一關都由程式把關）</h2>
          <ol className="ai-steps-list">
            <li>
              讀取故事，擴寫成<b>劇本大綱</b>：4～6 章、每章的轉折與兩難、角色的動機與秘密、伏筆、結局
            </li>
            <li>
              <b>大綱審查</b>：另一個 AI 以「RPG 前輩的設計方法」評分，沒通過就改大綱，<b>不准動工</b>
            </li>
            <li>
              <b>一次只做一章</b>：畫地圖 → 建立角色 → 放事件（人物、門、寶箱、劇情）→ 任務日誌 → 章節標題
            </li>
            <li>
              每章從自己的起點<b>自動試玩</b>（不卡關、時長 10～25 分鐘），再通過<b>章節審查</b>，才能開始下一章
            </li>
            <li>
              全部完成後<b>整體審查</b>，通過才<b>發布</b>；沒通過時會停下來回報原因，不會自行放寬標準
            </li>
          </ol>
          <div className="small muted">每一次審查的分數與意見都會上傳到專案的「總覽」，你可以隨時看到 AI 卡在哪一關。</div>
          <details>
            <summary className="small">AI 送出的「操作」長什麼樣？</summary>
            <p className="small muted">AI 不改程式碼，而是送出和你在編輯器點按時相同的操作（RPG Maker 式的角色、事件與指令），所以你能即時看到、也能手動修改：</p>
            <pre className="code-block">{EXAMPLE_OPS}</pre>
          </details>
        </section>

        <section className="card stack">
          <h2>API Token</h2>
          <table className="version-table" data-testid="token-table">
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
              {tokens.length === 0 && (
                <tr>
                  <td colSpan={5} className="small muted">
                    還沒有 Token，請在上方步驟 1 產生。
                  </td>
                </tr>
              )}
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
        </section>

        <section className="card stack">
          <h2>常見問題</h2>
          <dl className="glossary">
            <dt>需要申請 Claude 的 API key 嗎？</dt>
            <dd>不需要。AI 是你在 VS Code 裡登入的 Claude Code，費用由你自己的 Claude Code 帳號負擔；Studio 本身不呼叫任何 AI。</dd>
            <dt>AI 可以做什麼、不能做什麼？</dt>
            <dd>可以建立專案、修改內容、發布。不能典藏專案、不能管理 Token，也不能略過品質指標發布；所有修改都留下版本紀錄，你可以隨時還原。</dd>
            <dt>我和 AI 同時修改會互相覆蓋嗎？</dt>
            <dd>不會。每次修改都帶版本號；同時修改時，後送出的一方會收到衝突提示，需要重新讀取最新版本再操作。</dd>
            <dt>不想讓 AI 繼續操作了？</dt>
            <dd>在上方 Token 列表按「撤銷」，AI 會立即失去權限。</dd>
            <dt>給 AI 讀的 API 文件在哪裡？</dt>
            <dd>{origin}/api/docs（AI 會自己讀，你不需要看）</dd>
          </dl>
        </section>
          </>
        )}
      </div>
    </StudioShell>
  );
}
