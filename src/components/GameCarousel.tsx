"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import CoverArt from "@/components/game/CoverArt";
import { GENRE_LABELS } from "@/game/schema";
import type { CatalogEntry } from "@/lib/packs";

/**
 * 首頁的遊戲選單輪播：可以左右滑動（手機）、按箭頭或點圓點切換。
 * 遊戲數量少時補上「建立新遊戲」與「製作中」卡片，讓玩家一眼看出這裡可以選遊戲。
 */
export default function GameCarousel({ games, onCreate }: { games: CatalogEntry[]; onCreate: () => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const placeholders = games.length < 3 ? ["create", "soon"] : ["create"];
  const total = games.length + placeholders.length;

  const goTo = (index: number) => {
    const track = trackRef.current;
    const card = track?.children[Math.max(0, Math.min(total - 1, index))] as HTMLElement | undefined;
    if (track && card) track.scrollTo({ left: card.offsetLeft - (track.clientWidth - card.clientWidth) / 2, behavior: "smooth" });
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    const center = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestDist = Infinity;
    Array.from(track.children).forEach((child, i) => {
      const el = child as HTMLElement;
      const dist = Math.abs(el.offsetLeft + el.clientWidth / 2 - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setActive(best);
  };

  return (
    <div className="carousel" data-testid="library">
      <button className="carousel-arrow left" aria-label="上一款" disabled={active === 0} onClick={() => goTo(active - 1)}>
        ◀
      </button>
      <div className="carousel-track" ref={trackRef} onScroll={onScroll}>
        {games.map((g, i) => (
          <Link key={g.id} className={`game-card${i === active ? " active" : ""}`} href={`/play/?pack=${encodeURIComponent(g.id)}`} data-pack={g.id}>
            <div className="game-card-cover">
              <CoverArt cover={g.cover} />
              <div className="game-card-title">{g.title}</div>
              {g.cover.tagline && <div className="game-card-tagline">{g.cover.tagline}</div>}
              {g.typicalMinutes && (
                <div className="game-card-time">
                  ⏱ 約 {g.typicalMinutes[0]}～{g.typicalMinutes[1]} 分鐘・{g.endings} 種結局
                </div>
              )}
              <div className="game-card-play">▶ 開始遊戲</div>
            </div>
            <div className="game-card-body">
              <div className="row small">
                <span className="badge">{GENRE_LABELS[g.genre]}</span>
                {g.typicalMinutes && (
                  <span className="badge">
                    約 {g.typicalMinutes[0]}～{g.typicalMinutes[1]} 分鐘
                  </span>
                )}
                <span className="badge">{g.endings} 種結局</span>
                {g.status === "approved" && <span className="badge ok">AI 生成・審查通過</span>}
                {g.status === "demo" && <span className="badge">教學短篇</span>}
              </div>
              <p className="small muted game-card-desc">{g.description}</p>
            </div>
          </Link>
        ))}
        {placeholders.includes("create") && (
          <button className="game-card placeholder" onClick={onCreate} data-testid="carousel-create">
            <div className="placeholder-icon">＋</div>
            <div className="placeholder-title">用你的故事建立新遊戲</div>
            <div className="small muted">貼上故事，AI 會生成可以玩到結局的 RPG</div>
          </button>
        )}
        {placeholders.includes("soon") && (
          <div className="game-card placeholder soon">
            <div className="placeholder-icon">⌛</div>
            <div className="placeholder-title">更多遊戲製作中</div>
            <div className="small muted">通過自動試玩與 AI 審查的作品會自動上架</div>
          </div>
        )}
      </div>
      <button className="carousel-arrow right" aria-label="下一款" disabled={active >= total - 1} onClick={() => goTo(active + 1)}>
        ▶
      </button>
      <div className="carousel-dots">
        {Array.from({ length: total }, (_, i) => (
          <button key={i} className={`carousel-dot${i === active ? " active" : ""}`} aria-label={`第 ${i + 1} 張`} onClick={() => goTo(i)} />
        ))}
      </div>
    </div>
  );
}
