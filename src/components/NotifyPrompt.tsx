"use client";

import { useEffect, useState } from "react";
import { enablePush, getPushStatus, rememberAsk, shouldAsk, type PushStatus } from "@/lib/push";

/**
 * 第一次造訪時的「開啟通知」提示視窗（自訂視窗，玩家按「開啟通知」後才跳出瀏覽器的權限詢問）。
 * 「之後再說」7 天後再問；已開啟、已封鎖或不支援就不顯示。iPhone／iPad 未加入主畫面時改為說明怎麼加入。
 */
export default function NotifyPrompt({ delay = 1200 }: { delay?: number }) {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && !new URLSearchParams(window.location.search).has("notify")) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void getPushStatus().then((s) => {
        if (alive && shouldAsk(s)) setStatus(s);
      });
    }, delay);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [delay]);

  // 視窗開著時，鍵盤只給視窗用（不要同時操作到後面的遊戲）
  useEffect(() => {
    if (!status) return;
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        rememberAsk("later");
        setStatus(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [status]);

  if (!status) return null;
  const close = (when: "later" | "never") => {
    rememberAsk(when);
    setStatus(null);
  };
  const turnOn = async () => {
    setBusy(true);
    try {
      const s = await enablePush();
      if (s === "on") {
        setMessage("已開啟通知，有新消息會第一時間告訴你。");
        window.setTimeout(() => setStatus(null), 1600);
      } else if (s === "denied") {
        setMessage("瀏覽器封鎖了通知。之後想開啟，要到瀏覽器的網站設定裡允許通知。");
      } else close("later");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="notify-backdrop" data-testid="notify-prompt" onClick={(e) => e.target === e.currentTarget && close("later")}>
      <div className="notify-dialog" role="dialog" aria-modal="true" aria-labelledby="notify-title">
        <div className="notify-bell">🔔</div>
        <h2 id="notify-title">開啟通知？</h2>
        {status === "needs-install" ? (
          <>
            <p>iPhone／iPad 要先把這個網站加入主畫面，才能接收通知：</p>
            <p className="notify-steps">Safari 下方「分享」→「加入主畫面」→ 從主畫面開啟</p>
            <div className="notify-actions">
              <button className="btn primary" onClick={() => close("later")} data-testid="notify-ok">
                知道了
              </button>
            </div>
          </>
        ) : message ? (
          <>
            <p>{message}</p>
            <div className="notify-actions">
              <button className="btn primary" onClick={() => setStatus(null)}>
                好
              </button>
            </div>
          </>
        ) : (
          <>
            <p>這些時候我們會通知你：</p>
            <ul>
              <li>📖 新章節上線</li>
              <li>✨ 遊戲更新、🔧 問題修正</li>
              <li>🎮 新遊戲推出</li>
            </ul>
            <p className="notify-note">不會傳廣告，隨時可以在遊戲的「設定」裡關閉。</p>
            <div className="notify-actions">
              <button className="btn" onClick={() => close("later")} disabled={busy} data-testid="notify-later">
                之後再說
              </button>
              <button className="btn primary" onClick={turnOn} disabled={busy} data-testid="notify-enable" autoFocus>
                {busy ? "開啟中…" : "開啟通知"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
