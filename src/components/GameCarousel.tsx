"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CoverArt from "@/components/game/CoverArt";
import { SOUNDS } from "@/game/assets";
import { GENRE_LABELS } from "@/game/schema";
import { getAudio } from "@/lib/audio";
import type { CatalogEntry } from "@/lib/packs";

/**
 * 玩家首頁的遊戲選單（RPG 遊戲啟動器）：
 * 背景是選中遊戲的封面場景；左邊是 RPG 視窗的遊戲清單（↑↓ 選擇、Enter 開始，有游標音效）；
 * 右邊是遊戲資訊視窗：封面、標語、時長、章節、結局數，以及這台裝置上的存檔。
 */

type SaveInfo = { savedAt: string; ended: boolean } | null;

/** 只讀取 localStorage 的自動存檔時間，不必先下載整款遊戲 */
function readSave(id: string): SaveInfo {
  try {
    const raw = window.localStorage.getItem(`rpg:save:${id}:auto`);
    if (!raw) return null;
    const data = JSON.parse(raw) as { savedAt?: string; state?: { schemaVersion?: string; endingId?: string | null } };
    if (data.state?.schemaVersion !== "2.0" || !data.savedAt) return null;
    return { savedAt: data.savedAt, ended: Boolean(data.state.endingId) };
  } catch {
    return null;
  }
}

/** 手機：開始遊戲的那一下順便進入全螢幕（瀏覽器規定全螢幕必須由使用者的動作觸發） */
function enterImmersive() {
  if (!window.matchMedia("(pointer: coarse)").matches || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  void document.documentElement
    .requestFullscreen()
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape"))
    .catch(() => {});
}

const formatTime = (iso: string) => new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function GameLibrary({ games }: { games: CatalogEntry[] }) {
  const router = useRouter();
  const [active, setActive] = useState(0);
  const [saves, setSaves] = useState<Record<string, SaveInfo>>({});
  const game = games[active];

  useEffect(() => {
    const frame = requestAnimationFrame(() => setSaves(Object.fromEntries(games.map((g) => [g.id, readSave(g.id)]))));
    return () => cancelAnimationFrame(frame);
  }, [games]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "s" || e.key === "w") {
        e.preventDefault();
        getAudio().unlock();
        getAudio().play(SOUNDS.select, { volume: 0.25 });
        setActive((i) => (i + (e.key === "ArrowDown" || e.key === "s" ? 1 : -1) + games.length) % games.length);
      } else if ((e.key === "Enter" || e.key === "z" || e.key === " ") && games[active]) {
        e.preventDefault();
        router.push(`/play/?pack=${encodeURIComponent(games[active].id)}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [games, active, router]);

  if (!game) {
    return (
      <div className="launcher-empty rm-window" data-testid="library">
        遊戲製作中，敬請期待。
      </div>
    );
  }
  const save = saves[game.id];

  return (
    <div className="launcher" data-testid="library">
      <div className="launcher-backdrop" aria-hidden>
        <CoverArt key={game.id} cover={{ ...game.cover, characters: [] }} className="launcher-backdrop-art" />
      </div>

      <nav className="launcher-list rm-panel" aria-label="遊戲清單">
        <div className="rm-panel-title">選擇冒險</div>
        {games.map((g, i) => (
          <button
            key={g.id}
            className={`launcher-item${i === active ? " selected" : ""}`}
            data-pack={g.id}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onClick={() => {
              if (i !== active) return setActive(i);
              enterImmersive();
              router.push(`/play/?pack=${encodeURIComponent(g.id)}`);
            }}
          >
            <span className="launcher-cursor">{i === active ? "▶" : ""}</span>
            <span className="launcher-item-title">{g.title}</span>
            <span className="launcher-item-meta">
              {GENRE_LABELS[g.genre]}
              {g.release === "ongoing" ? "・連載中" : ""}
              {saves[g.id] ? "・💾" : ""}
            </span>
          </button>
        ))}
        <div className="launcher-soon">⌛ 更多冒險製作中</div>
      </nav>

      <section className="launcher-detail rm-panel" aria-live="polite">
        <div className="launcher-cover">
          <CoverArt key={game.id} cover={game.cover} />
          <div className="launcher-cover-title">{game.title}</div>
          {game.cover.tagline && <div className="launcher-cover-tagline">{game.cover.tagline}</div>}
        </div>
        <div className="launcher-stats">
          {game.typicalMinutes && (
            <span>
              ⏱ 約 {game.typicalMinutes[0]}～{game.typicalMinutes[1]} 分鐘
            </span>
          )}
          {game.release === "ongoing" ? (
            <span>📖 連載中・已推出 {game.chapters} 章{game.plannedChapters ? `／共 ${game.plannedChapters} 章` : ""}</span>
          ) : game.chapters ? (
            <span>📖 {game.chapters} 章</span>
          ) : null}
          <span>🏁 {game.endings} 種結局</span>
          <span>🎭 {GENRE_LABELS[game.genre]}</span>
          {game.status === "demo" && <span>教學短篇</span>}
        </div>
        <p className="launcher-desc">{game.description}</p>
        <div className="launcher-actions">
          <Link className="rm-button primary" href={`/play/?pack=${encodeURIComponent(game.id)}`} onClick={enterImmersive} data-testid="start-game">
            {save ? "▶ 繼續冒險" : "▶ 開始冒險"}
          </Link>
          {save && (
            <span className="launcher-save">
              💾 {save.ended ? "已通關" : "上次存檔"}・{formatTime(save.savedAt)}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
