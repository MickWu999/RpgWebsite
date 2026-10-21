"use client";

import { useState } from "react";
import { isAutomated } from "@/lib/analytics";

/**
 * 玩完一章時的玩家回饋（星等＋快速標籤＋一句話）。
 * 回饋存進資料庫，彙整成 AI 的案例庫：製作新遊戲與審查時，AI 會參考玩家實際喜歡與不喜歡的地方。
 * 每一章只問一次（記在這台裝置上），隨時可以略過。
 */

const TAGS = ["好笑", "感動", "劇情好", "角色可愛", "謎題有趣", "不知道下一步", "卡關", "太長", "太短", "對話太多", "選擇沒意義"];

export function feedbackAsked(gameId: string, chapterId: string) {
  try {
    return window.localStorage.getItem(`rpg:feedback:${gameId}:${chapterId}`) === "1";
  } catch {
    return true;
  }
}

function markAsked(gameId: string, chapterId: string) {
  try {
    window.localStorage.setItem(`rpg:feedback:${gameId}:${chapterId}`, "1");
  } catch {
    // 無法記住時，下次再問一次也無妨
  }
}

export default function FeedbackDialog({ gameId, chapterId, title, onDone }: { gameId: string; chapterId: string; title: string; onDone: () => void }) {
  const [rating, setRating] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const close = () => {
    markAsked(gameId, chapterId);
    onDone();
  };
  return (
    <div className="rm-feedback" data-testid="feedback" onKeyDown={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
      <div className="rm-panel rm-feedback-box">
        {sent ? (
          <>
            <div className="rm-feedback-title">謝謝你的回饋！</div>
            <p className="rm-dim">你的意見會讓接下來的章節變得更好。</p>
            <button className="rm-button primary" onClick={close} data-testid="feedback-close">
              繼續冒險
            </button>
          </>
        ) : (
          <>
            <div className="rm-feedback-title">「{title}」玩起來怎麼樣？</div>
            <div className="rm-stars" role="radiogroup" aria-label="評分">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={n <= rating ? "on" : ""} onClick={() => setRating(n)} aria-label={`${n} 顆星`} data-testid={`star-${n}`}>
                  ★
                </button>
              ))}
            </div>
            <div className="rm-feedback-tags">
              {TAGS.map((t) => (
                <button key={t} className={tags.includes(t) ? "on" : ""} onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}>
                  {t}
                </button>
              ))}
            </div>
            <textarea rows={2} maxLength={500} placeholder="想對製作者說的話（選填）" value={comment} onChange={(e) => setComment(e.target.value)} data-testid="feedback-comment" />
            <div className="rm-feedback-actions">
              <button className="rm-button" onClick={close}>
                略過
              </button>
              <button
                className="rm-button primary"
                disabled={rating === 0}
                data-testid="feedback-send"
                onClick={async () => {
                  // 自動化測試不送出，避免假回饋進入 AI 案例庫
                  if (!isAutomated())
                    await fetch("/api/feedback", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ gameId, chapterId, rating, tags, comment }),
                    }).catch(() => null);
                  setSent(true);
                }}
              >
                送出
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
