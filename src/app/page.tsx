"use client";

import { useEffect, useState } from "react";
import GameLibrary from "@/components/GameCarousel";
import NotifyPrompt from "@/components/NotifyPrompt";
import { InstallPrompt } from "@/components/PwaSupport";
import { fetchCatalog, type CatalogEntry } from "@/lib/packs";
import { fetchLatestNotice, NOTICE_ICON, type Notice } from "@/lib/push";

/** 首頁只顯示 14 天內的公告 */
const NOTICE_DAYS = 14;

/** 玩家首頁：RPG 遊戲啟動器（前台不連到後台 Studio） */
export default function Home() {
  const [library, setLibrary] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    void fetchLatestNotice().then((n) => setNotice(n && Date.now() - Date.parse(n.created_at) < NOTICE_DAYS * 864e5 ? n : null));
  }, []);

  useEffect(() => {
    fetchCatalog()
      .then((c) => setLibrary(c.games))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="portal-stage">
      <header className="portal-header">
        <div className="portal-logo">
          <span className="portal-logo-mark">◆</span>
          <div>
            <h1>AI RPG</h1>
            <div className="portal-logo-sub">Adventure Library</div>
          </div>
        </div>
        <InstallPrompt />
      </header>

      <main className="portal-main">
        {notice && (
          <a className="notice info portal-notice" href={notice.url} data-testid="latest-notice">
            {NOTICE_ICON[notice.kind]} <b>{notice.title}</b>　{notice.body}
          </a>
        )}
        {error && <div className="rm-panel portal-message">目前無法載入遊戲列表，請稍後再試。（{error}）</div>}
        {library === null && !error && <div className="rm-panel portal-message">載入冒險中…</div>}
        {library && <GameLibrary games={library} />}
      </main>

      <footer className="portal-footer">
        <span className="portal-keys">
          <kbd>↑</kbd>
          <kbd>↓</kbd> 選擇　<kbd>Enter</kbd> 開始　遊戲中：<kbd>方向鍵</kbd> 移動　<kbd>Z</kbd> 調查　<kbd>X</kbd> 選單
        </span>
        <span>手機請橫向遊玩・進度自動存在這台裝置・美術與音樂：Kenney、Juhani Junkala（CC0）</span>
      </footer>
      <NotifyPrompt />
    </div>
  );
}
