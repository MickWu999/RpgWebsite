"use client";

import { useEffect, useState } from "react";
import GameCarousel from "@/components/GameCarousel";
import { InstallPrompt } from "@/components/PwaSupport";
import { fetchCatalog, type CatalogEntry } from "@/lib/packs";

/** 玩家首頁：只有遊戲選單（前台不連到後台 Studio） */
export default function Home() {
  const [library, setLibrary] = useState<CatalogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCatalog()
      .then((c) => setLibrary(c.games))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="container portal">
      <header className="portal-header">
        <div>
          <h1>AI RPG</h1>
          <p className="muted">選一款冒險，從頭玩到結局。進度會自動存在這台裝置上。</p>
        </div>
        <div className="row">
          <InstallPrompt />
        </div>
      </header>

      <section className="library" aria-label="選擇遊戲">
        {error && <div className="notice err">目前無法載入遊戲列表，請稍後再試。（{error}）</div>}
        {library === null && !error && <div className="muted small">載入遊戲中…</div>}
        {library && <GameCarousel games={library} />}
      </section>

      <footer className="portal-footer small muted">
        操作：方向鍵／WASD 移動・Z／Enter 對話與確認・X／Esc 選單｜手機請橫向遊玩，可用搖桿或直接點擊畫面
        <br />
        美術與音樂：Kenney、Juhani Junkala（CC0）
      </footer>
    </div>
  );
}
