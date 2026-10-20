"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MUSIC, MUSIC, SOUNDS, TERRAIN, type MusicMood } from "@/game/assets";
import {
  advance,
  choose,
  confirm,
  createChapterState,
  createInitialState,
  endingEpilogues,
  facedTile,
  getMap,
  messageSpeaker,
  move,
  playerActor,
  questJournal,
  reconcileState,
  type ActionResult,
  type Direction,
  type GameEvent,
  type PlayerState,
} from "@/game/engine";
import { pathToFace, pathToTile } from "@/game/pathfinding";
import type { GameProject } from "@/game/schema";
import { coverDataOf } from "@/game/cover";
import { listSaves, savePlayerState, type SaveSlot } from "@/game/storage";
import { estimateDuration } from "@/game/duration";
import { runPlaytest } from "@/game/playtest";
import { validateProject } from "@/game/validate";
import { fetchPack } from "@/lib/packs";
import { studioApi } from "@/lib/studioApi";
import { getAudio } from "@/lib/audio";
import { STUDIO_CHANNEL, type StudioBroadcast } from "@/lib/studioChannel";
import {
  loadSettings,
  saveSettings,
  TEXT_SPEED_FACTOR,
  TEXT_SPEED_LABEL,
  VOICE_MODE_LABEL,
  VOICE_MODES,
  type Settings,
  type TextSpeed,
} from "@/lib/settings";
import CoverArt from "./CoverArt";
import DebugPanel from "./DebugPanel";
import MessageWindow, { type TypingControl } from "./MessageWindow";

const GameCanvas = dynamic(() => import("../GameCanvas"), { ssr: false });

/**
 * RPG Maker 式的單一遊戲畫面：開發者 Logo → 封面（按任意鍵開始）→ 標題 → 地圖 →（選單）→ 結局 → 標題。
 * 遊戲來源可以是模組包（/games/<id>/project.json）或後台的雲端專案（測試遊玩）。
 * 所有 UI 都畫在 640×480 的邏輯畫面裡，整體等比縮放到視窗大小。
 * 確認：Z／Enter／空白鍵／E　取消／選單：X／Esc　移動：方向鍵／WASD
 * 手機：直接用手指操作。點地面走過去、點人物或物件走過去對話或調查、點畫面讓對話繼續、點選項選擇，左上角「≡」開選單。
 * 第一次觸控時自動進入全螢幕並鎖定橫向；手機的返回鍵會開關遊戲選單，不會意外離開遊戲。
 * 後台測試遊玩另有：F9 除錯（開關、變數、章節跳轉）、從某章或某個位置直接開始、編輯器存檔後立即套用修改（不用重玩）。
 */

export const SCREEN_W = 640;
export const SCREEN_H = 480;
const MOVE_INTERVAL_MS = 140;
/** 手機橫向時畫面依螢幕比例變寬（固定寬 640，高度介於此範圍），搖桿與按鈕疊在畫面上 */
const MIN_SCREEN_H = 260;

type Mode = "loading" | "splash" | "cover" | "title" | "map" | "menu" | "ending";
export type TestStart = { chapterId?: string; at?: { mapId: string; x: number; y: number } };
export type GameSource = { kind: "pack" | "studio"; id: string; test?: TestStart };
type MenuPage = "root" | "items" | "quests" | "status" | "save" | "load" | "options" | "title";
type Toast = { id: number; text: string };
type UI = {
  mode: Mode;
  game: PlayerState;
  titleCursor: number;
  titleLoad: boolean;
  slotCursor: number;
  /** 系統訊息（開場文字、地形的預設回應） */
  messages: string[];
  messageSeq: number;
  choiceCursor: number;
  menuPage: MenuPage;
  menuCursor: number;
  subCursor: number;
  banner: { text: string; id: number } | null;
  fadeId: number;
  toasts: Toast[];
  notice: string | null;
  /** 自動存檔提示（重要事件後短暫顯示） */
  savedFlash: number;
  settings: Settings;
};

const TITLE_COMMANDS = ["新遊戲", "繼續", "讀取存檔", "離開"] as const;
const MENU_COMMANDS: Array<[MenuPage, string]> = [
  ["items", "道具"],
  ["quests", "任務"],
  ["status", "狀態"],
  ["save", "存檔"],
  ["load", "讀檔"],
  ["options", "設定"],
  ["title", "回到標題"],
];
const SAVE_LABEL: Record<SaveSlot, string> = { auto: "自動存檔", "1": "存檔 1", "2": "存檔 2", "3": "存檔 3" };
const TEXT_SPEEDS: TextSpeed[] = ["slow", "normal", "fast"];

type Key = Direction | "ok" | "cancel" | `digit${number}`;
function keyOf(e: KeyboardEvent): Key | null {
  switch (e.key) {
    case "ArrowUp":
    case "w":
    case "W":
      return "up";
    case "ArrowDown":
    case "s":
    case "S":
      return "down";
    case "ArrowLeft":
    case "a":
    case "A":
      return "left";
    case "ArrowRight":
    case "d":
    case "D":
      return "right";
    case "Enter":
    case " ":
    case "z":
    case "Z":
    case "e":
    case "E":
      return "ok";
    case "Escape":
    case "x":
    case "X":
      return "cancel";
  }
  return /^[1-9]$/.test(e.key) ? `digit${Number(e.key)}` : null;
}

function eventToast(project: GameProject, e: GameEvent): string | null {
  const item = (id: string) => project.items.find((i) => i.id === id)?.name ?? id;
  const quest = project.quests.find((q) => e.type === "quest" && q.id === e.questId);
  switch (e.type) {
    case "item":
      return e.delta > 0 ? `獲得了「${item(e.itemId)}」${e.delta > 1 ? `×${e.delta}` : ""}！` : `交出了「${item(e.itemId)}」`;
    case "quest":
      if (e.action === "start") return `新任務：${quest?.title ?? e.questId}`;
      if (e.action === "complete") return `任務完成：${quest?.title ?? e.questId}`;
      if (e.action === "fail") return `任務失敗：${quest?.title ?? e.questId}`;
      return "任務日誌已更新";
    default:
      return null;
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const sfx = (src: string, volume = 0.35) => getAudio().play(src, { volume });
const wrap = (n: number, len: number) => (len === 0 ? 0 : (n + len) % len);

function testState(project: GameProject, test: TestStart): PlayerState {
  const base = test.chapterId ? createChapterState(project, test.chapterId) : createInitialState(project);
  if (!test.at) return base;
  return reconcileState(project, { ...base, mapId: test.at.mapId, x: test.at.x, y: test.at.y, erased: [] });
}

export default function GameScreen({ source }: { source: GameSource }) {
  const projectId = source.id;
  const isStudio = source.kind === "studio";
  const [project, setProject] = useState<GameProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 載入資訊：模組包下載大小、預估遊玩時長（顯示在 Logo 與封面上） */
  const [loadInfo, setLoadInfo] = useState<{ bytes?: number; minutes: [number, number] | null }>({ minutes: null });
  const [ui, setUi] = useState<UI | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [layout, setLayout] = useState({ scale: 1, height: SCREEN_H, touch: false, portrait: false, canFullscreen: false });
  const [portraitOk, setPortraitOk] = useState(false);
  const router = useRouter();
  const inputRef = useRef<{ press: (key: Key) => void; release: (key: Key) => void; tap: (x: number, y: number) => void }>({
    press: () => {},
    release: () => {},
    tap: () => {},
  });
  const uiRef = useRef<UI | null>(null);
  const projectRef = useRef<GameProject | null>(null);
  const typingRef = useRef<TypingControl>({ typing: false, finish: () => {} });
  const clientTapRef = useRef<((clientX: number, clientY: number) => void) | null>(null);
  const seq = useRef(0);
  const toggleFullscreenRef = useRef<() => Promise<void>>(async () => {});
  /** 使用者自己按了「離開全螢幕」：之後不再自動進入 */
  const userExitedFullscreen = useRef(false);

  const update = useCallback((next: UI | ((u: UI) => UI)) => {
    const current = uiRef.current;
    if (!current) return;
    const value = typeof next === "function" ? next(current) : next;
    uiRef.current = value;
    setUi(value);
  }, []);

  // ---------- 載入 ----------
  useEffect(() => {
    let cancelled = false;
    const start = (project: GameProject) => {
      if (cancelled) return;
      projectRef.current = project;
      const latest = listSaves(project)
        .filter((s) => s.save)
        .sort((a, b) => b.save!.savedAt.localeCompare(a.save!.savedAt))[0];
      let game: PlayerState;
      let notice: string | null = null;
      try {
        game = source.test ? testState(project, source.test) : (latest?.save?.state ?? createInitialState(project));
      } catch (e) {
        game = createInitialState(project);
        notice = `無法從指定位置開始：${(e as Error).message}`;
      }
      const initial: UI = {
        // 後台的「從這裡測試」直接進地圖
        mode: source.test ? "map" : "splash",
        game,
        titleCursor: latest ? 1 : 0,
        titleLoad: false,
        slotCursor: 0,
        messages: [],
        messageSeq: 0,
        choiceCursor: 0,
        menuPage: "root",
        menuCursor: 0,
        subCursor: 0,
        banner: null,
        fadeId: 0,
        toasts: [],
        notice,
        savedFlash: 0,
        settings: loadSettings(),
      };
      uiRef.current = initial;
      setProject(project);
      setUi(initial);
      if (source.test) return;
      // 開發者 Logo 顯示一下後自動進入封面
      window.setTimeout(() => {
        if (!cancelled && uiRef.current?.mode === "splash") {
          uiRef.current = { ...uiRef.current, mode: "cover" };
          setUi(uiRef.current);
        }
      }, 1600);
    };
    if (source.kind === "studio") {
      // 後台測試遊玩：直接讀取雲端專案的最新版本（不需要先發布）
      studioApi
        .getProject(source.id)
        .then(({ project }) => {
          if (cancelled) return;
          try {
            setLoadInfo({ minutes: estimateDuration(project, runPlaytest(project, { maxStates: 1500 }))?.typicalMinutes ?? null });
          } catch {
            setLoadInfo({ minutes: null });
          }
          start(project);
        })
        .catch((e: Error) => !cancelled && setLoadError(e.message));
    } else {
      fetchPack(source.id)
        .then(({ project, bytes, entry }) => {
          if (cancelled) return;
          setLoadInfo({ bytes, minutes: entry?.typicalMinutes ?? null });
          start(project);
        })
        .catch((e: Error) => !cancelled && setLoadError(e.message));
    }
    return () => {
      cancelled = true;
    };
  }, [source.kind, source.id, source.test]);

  // ---------- 後台測試：編輯器存檔後立即套用（保留目前進度，不用重玩） ----------
  useEffect(() => {
    if (!isStudio || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(STUDIO_CHANNEL);
    channel.onmessage = (e: MessageEvent<StudioBroadcast>) => {
      const msg = e.data;
      if (msg?.type !== "project" || msg.projectId !== projectId || !uiRef.current) return;
      const valid = validateProject(msg.project);
      if (!valid.project) {
        update((u) => ({ ...u, notice: `編輯器的修改還有 ${valid.errors.length} 個錯誤，暫不套用` }));
        return;
      }
      const next = valid.project;
      projectRef.current = next;
      setProject(next);
      update((u) => ({ ...u, game: reconcileState(next, u.game), notice: "✓ 已套用編輯器的最新修改" }));
      window.setTimeout(() => update((u) => (u.notice === "✓ 已套用編輯器的最新修改" ? { ...u, notice: null } : u)), 2000);
    };
    return () => channel.close();
  }, [isStudio, projectId, update]);

  const cover = useMemo(() => (project ? coverDataOf(project) : null), [project]);

  // 網頁很容易被直接關掉：切到背景、關閉分頁時再強制存一次，並要求瀏覽器不要自動清除存檔
  useEffect(() => {
    const flush = () => {
      const u = uiRef.current;
      if (u && !source.test && (u.mode === "map" || u.mode === "menu" || u.mode === "ending")) {
        try {
          savePlayerState(u.game, "auto");
        } catch {
          // 儲存空間不足時已在遊戲中提示過
        }
      }
    };
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    void navigator.storage?.persist?.().catch(() => false);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [source.test]);

  // ---------- 縮放 ----------
  useEffect(() => {
    const resize = () => {
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const portrait = window.innerHeight > window.innerWidth;
      const canFullscreen = touch && Boolean(document.documentElement.requestFullscreen);
      if (touch && !portrait) {
        // 手機橫向：畫面寬度填滿螢幕，高度依螢幕比例決定，鏡頭跟著角色捲動
        const height = Math.round(Math.min(SCREEN_H, Math.max(MIN_SCREEN_H, (SCREEN_W * window.innerHeight) / window.innerWidth)));
        const scale = Math.min(window.innerWidth / SCREEN_W, window.innerHeight / height);
        setLayout({ scale, height, touch, portrait, canFullscreen });
        return;
      }
      // 桌面：4:3 等比放大；手機直向（備用）：下方保留手把空間
      const availableHeight = window.innerHeight;
      const scale = Math.max(0.3, Math.min(window.innerWidth / SCREEN_W, availableHeight / SCREEN_H));
      setLayout({ scale, height: SCREEN_H, touch, portrait, canFullscreen });
    };
    const frame = requestAnimationFrame(resize);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    (window as unknown as { __RPG_DEBUG__?: unknown }).__RPG_DEBUG__ = {
      projectId,
      getState: () => uiRef.current?.game,
      getMode: () => uiRef.current?.mode,
      getMessages: () => uiRef.current?.messages.length ?? 0,
      getMusic: () => getAudio().currentMusic,
      getBlips: () => getAudio().blipCount,
    };
  }, [projectId]);

  // ---------- 背景音樂：依模式與地圖切換；「背景音樂」指令可以覆寫 ----------
  const musicMode = ui?.mode;
  const musicMap = ui?.game.mapId;
  const musicOverride = ui?.game.music;
  const bgmOn = ui?.settings.bgm;
  useEffect(() => {
    const p = projectRef.current;
    if (!p || !musicMode || musicMode === "loading") return;
    if (!bgmOn || musicMode === "ending" || musicMode === "splash") {
      getAudio().playMusic(null);
      return;
    }
    if (musicMode !== "title" && musicMode !== "cover" && musicOverride !== undefined) {
      getAudio().playMusic(musicOverride ? MUSIC[musicOverride as MusicMood].src : null);
      return;
    }
    const mapId = musicMode === "title" || musicMode === "cover" ? (p.cover?.mapId ?? p.system.start.mapId) : musicMap!;
    const mood = p.maps.find((m) => m.id === mapId)?.music ?? DEFAULT_MUSIC;
    getAudio().playMusic(MUSIC[mood].src);
  }, [musicMode, musicMap, musicOverride, bgmOn]);

  useEffect(() => () => getAudio().playMusic(null), []);

  // ---------- 遊戲動作 ----------
  const flash = useCallback(
    (patch: Partial<UI>, ms = 2200, field: "banner" | "notice" = "banner") => {
      update((u) => ({ ...u, ...patch }));
      const value = patch[field];
      window.setTimeout(() => update((u) => (u[field] === value ? { ...u, [field]: null } : u)), ms);
    },
    [update],
  );

  const enterMap = useCallback(
    (game: PlayerState, messages: string[] = []) => {
      const p = projectRef.current!;
      const id = ++seq.current;
      update((u) => ({ ...u, game, mode: game.endingId ? "ending" : "map", messages, messageSeq: id, fadeId: id, choiceCursor: 0, menuPage: "root", titleLoad: false }));
      flash({ banner: { text: getMap(p, game.mapId).name, id } });
    },
    [update, flash],
  );

  const act = useCallback(
    (fn: (p: GameProject, s: PlayerState) => ActionResult) => {
      const p = projectRef.current;
      const u = uiRef.current;
      if (!p || !u) return;
      let result: ActionResult;
      try {
        result = fn(p, u.game);
      } catch (e) {
        // 事件設計錯誤（例如無限迴圈）：遊戲不會當掉，顯示錯誤讓製作者修正
        flash({ notice: `事件錯誤：${(e as Error).message}` }, 6000, "notice");
        return;
      }
      if (result.state === u.game) return;
      const before = u.game.message;
      const toasts = result.events.map((e) => eventToast(p, e)).filter((t): t is string => Boolean(t)).map((text) => ({ id: ++seq.current, text }));
      const transferred = result.events.some((e) => e.type === "transferred");
      const important = result.events.some((e) => e.type === "item" || e.type === "quest" || e.type === "transferred" || e.type === "chapter" || e.type === "ending");
      const fadeId = transferred ? ++seq.current : u.fadeId;
      if (!before && result.state.message?.kind === "text") sfx(SOUNDS.dialogueOpen, 0.3);
      if (before && !result.state.message && !result.state.endingId) sfx(SOUNDS.dialogueClose, 0.25);
      update({
        ...u,
        game: result.state,
        mode: result.state.endingId ? "ending" : u.mode,
        choiceCursor: result.state.message !== u.game.message ? 0 : u.choiceCursor,
        toasts: [...u.toasts, ...toasts].slice(-4),
        fadeId,
        savedFlash: important && !source.test ? ++seq.current : u.savedFlash,
      });
      if (transferred) flash({ banner: { text: getMap(p, result.state.mapId).name, id: fadeId } });
      for (const t of toasts) window.setTimeout(() => update((x) => ({ ...x, toasts: x.toasts.filter((y) => y.id !== t.id) })), 2600);
      if (!source.test) {
        try {
          savePlayerState(result.state, "auto");
        } catch (e) {
          flash({ notice: (e as Error).message }, 4000, "notice");
        }
      }
      getAudio().handleEvents(p, result.state, result.events);
    },
    [update, flash, source.test],
  );

  const newGame = useCallback(
    (chapterId?: string) => {
      const p = projectRef.current!;
      const fresh = chapterId ? createChapterState(p, chapterId) : createInitialState(p);
      if (!source.test) savePlayerState(fresh, "auto");
      const intro = chapterId ? [] : (p.intro ?? "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
      enterMap(fresh, intro);
    },
    [enterMap, source.test],
  );

  const loadSlot = useCallback(
    (slot: SaveSlot) => {
      const p = projectRef.current!;
      const entry = listSaves(p).find((s) => s.slot === slot);
      if (!entry?.save) {
        flash({ notice: entry?.notice ?? "這個欄位沒有存檔" }, 2200, "notice");
        return false;
      }
      enterMap(entry.save.state);
      return true;
    },
    [enterMap, flash],
  );

  const saveToSlot = useCallback(
    (slot: SaveSlot) => {
      const u = uiRef.current;
      if (!u) return;
      savePlayerState(u.game, slot);
      sfx(SOUNDS.objective);
      flash({ notice: `已儲存到「${SAVE_LABEL[slot]}」` }, 2200, "notice");
      update((x) => ({ ...x }));
    },
    [flash, update],
  );

  // ---------- 手機的返回鍵：在遊戲中開關選單，不會意外離開（標題畫面以前照常返回上一頁） ----------
  useEffect(() => {
    window.history.pushState({ rpg: true }, "");
    const onPop = () => {
      const u = uiRef.current;
      if (!u || u.mode === "splash" || u.mode === "cover" || u.mode === "title" || u.mode === "loading") {
        window.history.back();
        return;
      }
      if (u.mode === "menu") update({ ...u, mode: "map" });
      else if (u.mode === "map" && !u.game.message && u.messages.length === 0 && !u.game.interpreter) update({ ...u, mode: "menu", menuPage: "root", menuCursor: 0, subCursor: 0 });
      else if (u.mode === "ending") update({ ...u, mode: "title", titleCursor: 0 });
      window.history.pushState({ rpg: true }, "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [update]);

  // ---------- 鍵盤與觸控輸入 ----------
  useEffect(() => {
    const held: Direction[] = [];
    let lastMove = 0;
    // 點擊移動：依尋路結果一步步走；走到事件前面後自動按確定鍵。任何按鍵輸入都會取消
    let walkQueue: Direction[] = [];
    let confirmAfterWalk = false;
    const canWalk = () => {
      const u = uiRef.current;
      return Boolean(u && u.mode === "map" && !u.game.message && !u.game.interpreter && u.messages.length === 0 && !u.game.endingId);
    };
    const step = (dir: Direction) => {
      lastMove = performance.now();
      act((p, s) => move(p, s, dir));
    };

    const handle = (key: Key) => {
      const u = uiRef.current;
      const p = projectRef.current;
      if (!u || !p) return;

      if (u.mode === "splash" || u.mode === "cover") {
        if (u.mode === "cover") sfx(SOUNDS.select);
        update({ ...u, mode: u.mode === "splash" ? "cover" : "title" });
        return;
      }
      if (u.mode === "title") {
        if (u.titleLoad) {
          if (key === "up" || key === "down") update({ ...u, slotCursor: wrap(u.slotCursor + (key === "up" ? -1 : 1), 4) });
          else if (key === "cancel") update({ ...u, titleLoad: false });
          else if (key === "ok" && loadSlot((["auto", "1", "2", "3"] as SaveSlot[])[u.slotCursor])) sfx(SOUNDS.select);
          return;
        }
        if (key === "up" || key === "down") update({ ...u, titleCursor: wrap(u.titleCursor + (key === "up" ? -1 : 1), TITLE_COMMANDS.length) });
        else if (key === "ok") {
          sfx(SOUNDS.select);
          const command = TITLE_COMMANDS[u.titleCursor];
          if (command === "新遊戲") newGame();
          else if (command === "繼續") {
            const latest = listSaves(p).filter((s) => s.save).sort((a, b) => b.save!.savedAt.localeCompare(a.save!.savedAt))[0];
            if (latest) enterMap(latest.save!.state);
            else flash({ notice: "沒有可以繼續的存檔" }, 2200, "notice");
          } else if (command === "讀取存檔") update({ ...u, titleLoad: true, slotCursor: 0 });
          else router.push(isStudio ? `/studio/project/?id=${source.id}` : "/");
        }
        return;
      }

      if (u.mode === "ending") {
        if (key === "ok") update({ ...u, mode: "title", titleCursor: 0, titleLoad: false });
        return;
      }

      if (u.mode === "menu") {
        handleMenu(key, u, p);
        return;
      }

      // 地圖：系統訊息 → 事件的文字／選項／章節標題 → 自由行動
      if (u.messages.length > 0) {
        if (key === "ok") {
          if (typingRef.current.typing) typingRef.current.finish();
          else update({ ...u, messages: u.messages.slice(1), messageSeq: ++seq.current });
        }
        return;
      }
      const msg = u.game.message;
      if (msg) {
        const choices = msg.kind === "text" ? (msg.choices ?? []) : [];
        if (key === "ok") {
          if (typingRef.current.typing && msg.kind === "text") typingRef.current.finish();
          else if (choices.length > 0) {
            sfx(SOUNDS.select);
            act((pp, s) => choose(pp, s, choices[u.choiceCursor].index));
          } else act(advance);
        } else if ((key === "up" || key === "down") && choices.length > 0 && !typingRef.current.typing) {
          update({ ...u, choiceCursor: wrap(u.choiceCursor + (key === "up" ? -1 : 1), choices.length) });
        } else if (key.startsWith("digit") && !typingRef.current.typing) {
          const option = choices[Number(key.slice(5)) - 1];
          if (option) {
            sfx(SOUNDS.select);
            act((pp, s) => choose(pp, s, option.index));
          }
        }
        return;
      }
      if (u.game.interpreter) return;
      if (key === "ok") examineFront();
      else if (key === "cancel") {
        sfx(SOUNDS.dialogueOpen);
        update({ ...u, mode: "menu", menuPage: "root", menuCursor: 0, subCursor: 0 });
      }
    };

    const handleMenu = (key: Key, u: UI, p: GameProject) => {
      const vertical = key === "up" || key === "down";
      const delta = key === "up" ? -1 : 1;
      if (u.menuPage === "root") {
        if (vertical) update({ ...u, menuCursor: wrap(u.menuCursor + delta, MENU_COMMANDS.length) });
        else if (key === "cancel") {
          sfx(SOUNDS.dialogueClose);
          update({ ...u, mode: "map" });
        } else if (key === "ok") {
          sfx(SOUNDS.select);
          update({ ...u, menuPage: MENU_COMMANDS[u.menuCursor][0], subCursor: 0 });
        }
        return;
      }
      if (key === "cancel") {
        sfx(SOUNDS.dialogueClose);
        update({ ...u, menuPage: "root" });
        return;
      }
      const count = { items: Object.keys(u.game.items).length, quests: questJournal(p, u.game).length, status: 0, save: 3, load: 4, options: 4, title: 2 }[u.menuPage];
      if (vertical) {
        update({ ...u, subCursor: wrap(u.subCursor + delta, count) });
        return;
      }
      if (u.menuPage === "save" && key === "ok") {
        saveToSlot(String(u.subCursor + 1) as SaveSlot);
      } else if (u.menuPage === "load" && key === "ok") {
        if (loadSlot((["auto", "1", "2", "3"] as SaveSlot[])[u.subCursor])) sfx(SOUNDS.select);
      } else if (u.menuPage === "options" && (key === "ok" || key === "left" || key === "right")) {
        const s = { ...u.settings };
        if (u.subCursor === 0) s.textSpeed = TEXT_SPEEDS[wrap(TEXT_SPEEDS.indexOf(s.textSpeed) + (key === "left" ? -1 : 1), 3)];
        if (u.subCursor === 1) getAudio().setMuted(!getAudio().muted);
        if (u.subCursor === 2) s.bgm = !s.bgm;
        if (u.subCursor === 3) s.voice = VOICE_MODES[wrap(VOICE_MODES.indexOf(s.voice) + (key === "left" ? -1 : 1), VOICE_MODES.length)];
        saveSettings(s);
        sfx(SOUNDS.select);
        update({ ...u, settings: s });
      } else if (u.menuPage === "title" && key === "ok") {
        if (u.subCursor === 0) update({ ...u, mode: "title", titleCursor: 1, titleLoad: false });
        else update({ ...u, menuPage: "root" });
      }
    };

    /** 按確定鍵：觸發腳下或面前的事件；什麼都沒有時，給面前地形的預設回應 */
    const examineFront = () => {
      const before = uiRef.current?.game;
      const p = projectRef.current;
      if (!before || !p) return;
      act(confirm);
      if (uiRef.current?.game !== before) return;
      const { x, y } = facedTile(before);
      const row = getMap(p, before.mapId).terrain[y];
      const text = row ? TERRAIN[[...row][x]]?.examine : undefined;
      if (text) update((u) => ({ ...u, messages: [text], messageSeq: ++seq.current }));
    };

    const tap = (x: number, y: number) => {
      const u = uiRef.current;
      const p = projectRef.current;
      if (!u || !p) return;
      getAudio().unlock();
      // 地圖以外的狀態（訊息、對話中），點擊畫面等同按確定鍵
      if (!canWalk()) {
        if (u.mode === "map") handle("ok");
        return;
      }
      // 點事件：走過去觸發；點不可通行的地形：走到前面調查；點地面：走過去
      const map = getMap(p, u.game.mapId);
      const route = pathToTile(p, u.game, x, y);
      if (route) {
        walkQueue = route.moves;
        confirmAfterWalk = route.confirm;
        return;
      }
      if (map.walkable[y]?.[x] === false) {
        walkQueue = pathToFace(p, u.game, x, y) ?? [];
        confirmAfterWalk = walkQueue.length > 0;
      }
    };

    const press = (key: Key, repeat = false) => {
      walkQueue = [];
      confirmAfterWalk = false;
      getAudio().unlock();
      const isDir = key === "up" || key === "down" || key === "left" || key === "right";
      if (isDir && canWalk()) {
        if (!held.includes(key)) held.push(key);
        if (!repeat) step(key);
        return;
      }
      if (!repeat) handle(key);
    };
    const release = (key: Key) => {
      const index = held.indexOf(key as Direction);
      if (index >= 0) held.splice(index, 1);
    };
    inputRef.current = { press: (key) => press(key), release, tap };

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if ((e.key === "f" || e.key === "F") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        void toggleFullscreenRef.current();
        return;
      }
      document.body.classList.add("rm-hide-cursor");
      if (e.key === "F9" && isStudio) {
        e.preventDefault();
        setDebugOpen((v) => !v);
        return;
      }
      const key = keyOf(e);
      if (!key) return;
      e.preventDefault();
      press(key, e.repeat);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = keyOf(e);
      if (key) release(key);
    };
    const onBlur = () => held.splice(0);
    const onMouseMove = () => document.body.classList.remove("rm-hide-cursor");
    window.addEventListener("mousemove", onMouseMove);
    const timer = window.setInterval(() => {
      if (walkQueue.length > 0 || confirmAfterWalk) {
        if (!canWalk()) {
          walkQueue = [];
          confirmAfterWalk = false;
        } else if (performance.now() - lastMove >= MOVE_INTERVAL_MS) {
          const next = walkQueue.shift();
          if (next) step(next);
          else {
            confirmAfterWalk = false;
            examineFront();
          }
        }
        return;
      }
      const dir = held[held.length - 1];
      if (!dir) return;
      if (!canWalk()) held.splice(0);
      else if (performance.now() - lastMove >= MOVE_INTERVAL_MS) step(dir);
    }, 30);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMouseMove);
      document.body.classList.remove("rm-hide-cursor");
      window.clearInterval(timer);
    };
  }, [act, update, flash, newGame, enterMap, loadSlot, saveToSlot, router, isStudio, source.id]);

  /** Android 等支援的瀏覽器：切換全螢幕（進入時鎖定橫向，再按一次離開）；iPhone Safari 不支援，按鈕不顯示 */
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const enterFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        userExitedFullscreen.current = true;
        (screen.orientation as ScreenOrientation & { unlock?: () => void }).unlock?.();
        await document.exitFullscreen();
        return;
      }
      await document.documentElement.requestFullscreen();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch {
      // 不支援鎖定方向時維持全螢幕即可
    }
  }, []);
  useEffect(() => {
    toggleFullscreenRef.current = enterFullscreen;
  }, [enterFullscreen]);

  // 章節標題卡真正出現在畫面上時才播放音效（開場的章節事件發生在遊戲建立當下）
  const cardKey = ui && ui.mode === "map" && ui.messages.length === 0 && ui.game.message?.kind === "chapter" ? `${ui.game.message.chapterId}:${ui.messageSeq}` : null;
  useEffect(() => {
    if (cardKey) sfx(SOUNDS.levelUp, 0.45);
  }, [cardKey]);

  // ---------- 畫面 ----------
  if (loadError) {
    return (
      <div className="rm-stage">
        <div className="rm-error">
          <p>{loadError}</p>
          <Link href={isStudio ? "/studio/" : "/"}>回到網站</Link>
        </div>
      </div>
    );
  }
  if (!project || !ui) {
    return (
      <div className="rm-stage">
        <div className="rm-loading" data-testid="loading">
          {source.kind === "pack" ? "下載遊戲資料中…" : "載入中…"}
        </div>
      </div>
    );
  }

  const game = ui.game;
  const msg = ui.mode !== "title" ? game.message : null;
  const textMsg = msg?.kind === "text" ? msg : null;
  const chapterCard = msg?.kind === "chapter" ? project.chapters.find((c) => c.id === msg.chapterId) : undefined;
  const speaker = textMsg ? messageSpeaker(project, textMsg) : null;
  const choices = textMsg?.choices ?? [];
  const asset = (id?: string) => project.assetManifest.assets.find((a) => a.id === id);
  const speed = TEXT_SPEED_FACTOR[ui.settings.textSpeed];
  const ending = game.endingId ? project.endings.find((e) => e.id === game.endingId) : null;
  const chapter = project.chapters.find((c) => c.id === game.chapterId);
  const hero = playerActor(project);
  const journal = questJournal(project, game);
  const saves = ui.mode === "title" || ui.menuPage === "save" || ui.menuPage === "load" ? listSaves(project) : [];
  const hasSave = saves.some((s) => s.save);
  return (
    <div
      className={`rm-stage${layout.touch ? " touch" : ""}${layout.portrait ? " portrait" : ""}`}
      onPointerDown={() => {
        getAudio().unlock();
        // 手機：第一次觸控就進入全螢幕（瀏覽器規定必須由使用者的動作觸發；iPhone Safari 不支援，改用加入主畫面）
        if (layout.touch && layout.canFullscreen && !document.fullscreenElement && !userExitedFullscreen.current) void enterFullscreen();
      }}
    >
      <div className="rm-screen-box" style={{ width: SCREEN_W * layout.scale, height: layout.height * layout.scale }}>
        <div
          className={`rm-screen${layout.height < 400 ? " short" : ""}`}
          style={{ width: SCREEN_W, height: layout.height, transform: `scale(${layout.scale})` }}
          data-testid="game-frame"
          data-mode={ui.mode}
        >
          <GameCanvas project={project} state={game} viewHeight={layout.height} onTileTap={(x, y) => inputRef.current.tap(x, y)} clientTapRef={clientTapRef} />

          {ui.mode !== "title" && <div key={ui.fadeId} className="rm-fade" />}

          {ui.mode !== "title" && ui.mode !== "cover" && ui.mode !== "splash" && <div className="rm-vignette" aria-hidden />}

          {ui.banner && ui.mode === "map" && !chapterCard && (
            <div key={ui.banner.id} className="rm-window rm-banner" data-testid="map-name">
              {ui.banner.text}
            </div>
          )}

          <div className="rm-toasts" aria-live="polite">
            {ui.toasts.map((t) => (
              <div key={t.id} className="rm-window rm-toast">
                {t.text}
              </div>
            ))}
          </div>

          {ui.mode === "map" && ui.messages.length > 0 && (
            <MessageWindow
              key={`sys${ui.messageSeq}`}
              text={ui.messages[0]}
              speedFactor={speed}
              choices={[]}
              cursor={0}
              controlRef={typingRef}
              onChoose={() => {}}
              onContinue={() => update((u) => ({ ...u, messages: u.messages.slice(1), messageSeq: ++seq.current }))}
            />
          )}
          {(ui.mode === "map" || ui.mode === "menu") && ui.messages.length === 0 && textMsg && (
            <MessageWindow
              key={`${game.interpreter ? JSON.stringify(game.interpreter.frames.at(-1)) : ""}:${game.choiceLog.length}:${textMsg.text}`}
              speaker={speaker?.name}
              text={textMsg.text}
              voice={speaker?.voice}
              portrait={asset(speaker?.spriteAssetId)}
              portraitSize={layout.height < 400 ? 52 : 72}
              speedFactor={speed}
              voiceMode={ui.settings.voice}
              choices={choices}
              cursor={ui.choiceCursor}
              controlRef={typingRef}
              onChoose={(index) => {
                sfx(SOUNDS.select);
                act((p, s) => choose(p, s, index));
              }}
              onContinue={() => act(advance)}
            />
          )}
          {ui.mode === "map" && ui.messages.length === 0 && chapterCard && (
            <div className="rm-chapter" data-testid="chapter-card" onClick={() => act(advance)}>
              <div className="rm-chapter-title">{chapterCard.title}</div>
              {chapterCard.summary && <div className="rm-chapter-summary">{chapterCard.summary}</div>}
              <div className="rm-hint">{layout.touch ? "點一下繼續" : "按確定鍵繼續"}</div>
            </div>
          )}

          {(ui.mode === "cover" || ui.mode === "title") && cover && <CoverArt cover={cover} className="rm-cover-bg" />}

          {ui.mode === "splash" && (
            <div className="rm-splash" data-testid="splash" onClick={() => update((u) => ({ ...u, mode: "cover" }))}>
              <div className="rm-splash-logo">AI RPG Builder</div>
              <div className="rm-splash-sub">presents</div>
              {loadInfo.bytes !== undefined && <div className="rm-splash-status">✓ 遊戲資料已下載（{Math.max(1, Math.round(loadInfo.bytes / 1024))} KB）</div>}
            </div>
          )}

          {ui.mode === "cover" && (
            <div className="rm-cover" data-testid="cover-screen" onClick={() => update((u) => ({ ...u, mode: "title" }))}>
              <h1 className="rm-game-title">{project.title}</h1>
              {project.cover?.tagline && <p className="rm-tagline">{project.cover.tagline}</p>}
              <div className="rm-cover-meta" data-testid="cover-meta">
                {loadInfo.minutes && (
                  <span>
                    ⏱ 預計遊玩 {loadInfo.minutes[0]}～{loadInfo.minutes[1]} 分鐘
                  </span>
                )}
                {project.chapters.length > 0 && <span>📖 {project.chapters.length} 章</span>}
                <span>🏁 {project.endings.length} 種結局</span>
              </div>
              <div className="rm-press-start">{layout.touch ? "點擊畫面開始" : "按任意鍵開始"}</div>
            </div>
          )}

          {ui.mode === "title" && (
            <div className="rm-title" data-testid="title-screen">
              <h1 className="rm-game-title">{project.title}</h1>
              <p className="rm-subtitle">{project.cover?.tagline ?? project.description}</p>
              {ui.titleLoad ? (
                <div className="rm-window rm-title-slots">
                  {(["auto", "1", "2", "3"] as SaveSlot[]).map((slot, i) => (
                    <SlotRow key={slot} project={project} slot={slot} entry={saves.find((x) => x.slot === slot)} selected={i === ui.slotCursor} onSelect={loadSlot} />
                  ))}
                </div>
              ) : (
                <div className="rm-window rm-title-commands">
                  {TITLE_COMMANDS.map((c, i) => (
                    <button
                      key={c}
                      className={`rm-item${i === ui.titleCursor ? " selected" : ""}${(c === "繼續" || c === "讀取存檔") && !hasSave ? " disabled" : ""}`}
                      onClick={() => {
                        update((u) => ({ ...u, titleCursor: i }));
                        if (c === "新遊戲") newGame();
                        else if (c === "繼續") {
                          const latest = saves.filter((s) => s.save).sort((a, b) => b.save!.savedAt.localeCompare(a.save!.savedAt))[0];
                          if (latest) enterMap(latest.save!.state);
                        } else if (c === "讀取存檔") update((u) => ({ ...u, titleLoad: true, slotCursor: 0 }));
                        else router.push(isStudio ? `/studio/project/?id=${source.id}` : "/");
                      }}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
              <div className="rm-hint">{layout.touch ? "點一下選擇" : `方向鍵選擇・Z／Enter 確認・X／Esc 取消${isStudio ? "・F9 除錯" : ""}`}</div>
            </div>
          )}

          {ui.mode === "menu" && (
            <div className="rm-menu" data-testid="menu">
              <div className="rm-window rm-menu-commands">
                <button className="rm-item rm-menu-close" onClick={() => update((u) => ({ ...u, mode: "map" }))} data-testid="menu-close">
                  ✕ 關閉
                </button>
                {MENU_COMMANDS.map(([page, label], i) => (
                  <button
                    key={page}
                    className={`rm-item${i === ui.menuCursor ? " selected" : ""}${ui.menuPage === page ? " active" : ""}`}
                    onClick={() => update((u) => ({ ...u, menuCursor: i, menuPage: page, subCursor: 0 }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="rm-window rm-menu-body">
                {(ui.menuPage === "root" || ui.menuPage === "status") && (
                  <div className="rm-status-card">
                    <div className="rm-heading">{hero.name}</div>
                    {ui.menuPage === "status" && hero.profile && <p className="rm-dim">{hero.profile}</p>}
                    {chapter && <div>{chapter.title}</div>}
                    <div className="rm-dim" style={{ marginTop: 12 }}>
                      所在地：{getMap(project, game.mapId).name}・步數 {game.steps}
                    </div>
                    <div className="rm-dim">完成任務：{journal.filter((q) => q.status === "completed").length}／{project.quests.length}</div>
                  </div>
                )}
                {ui.menuPage === "items" &&
                  (Object.keys(game.items).length === 0 ? (
                    <div className="rm-dim">沒有任何道具。</div>
                  ) : (
                    Object.entries(game.items).map(([id, count], i) => {
                      const item = project.items.find((x) => x.id === id);
                      return (
                        <div key={id} className={`rm-item${i === ui.subCursor ? " selected" : ""}`} onClick={() => update((u) => ({ ...u, subCursor: i }))}>
                          <div className="rm-row">
                            <span>{item?.name ?? id}</span>
                            <span>×{count}</span>
                          </div>
                          {i === ui.subCursor && <div className="rm-dim rm-desc">{item?.description}</div>}
                        </div>
                      );
                    })
                  ))}
                {ui.menuPage === "quests" &&
                  (journal.length === 0 ? (
                    <div className="rm-dim">目前沒有任務。試著和附近的人說說話。</div>
                  ) : (
                    journal.map((q) => (
                      <div key={q.id} className="rm-quest" data-testid="quest">
                        <div className="rm-row">
                          <span className="rm-heading">{q.title}</span>
                          <span className={q.status === "completed" ? "rm-ok" : "rm-warn"}>{{ active: "進行中", completed: "完成", failed: "失敗", inactive: "" }[q.status]}</span>
                        </div>
                        {q.steps.map((st, i) => (
                          <div key={i} className={`rm-objective${st.done ? " done" : ""}${st.current ? " current" : ""}`}>
                            {st.text}
                          </div>
                        ))}
                      </div>
                    ))
                  ))}
                {ui.menuPage === "save" &&
                  (["1", "2", "3"] as SaveSlot[]).map((slot, i) => (
                    <SlotRow key={slot} project={project} slot={slot} entry={saves.find((x) => x.slot === slot)} selected={i === ui.subCursor} onSelect={saveToSlot} />
                  ))}
                {ui.menuPage === "load" &&
                  (["auto", "1", "2", "3"] as SaveSlot[]).map((slot, i) => (
                    <SlotRow key={slot} project={project} slot={slot} entry={saves.find((x) => x.slot === slot)} selected={i === ui.subCursor} onSelect={loadSlot} />
                  ))}
                {ui.menuPage === "options" &&
                  [
                    ["文字速度", TEXT_SPEED_LABEL[ui.settings.textSpeed]],
                    ["音效", getAudio().muted ? "關" : "開"],
                    ["背景音樂", ui.settings.bgm ? "開" : "關"],
                    ["對話聲音", VOICE_MODE_LABEL[ui.settings.voice]],
                  ].map(([label, value], i) => (
                    <button
                      key={label}
                      className={`rm-item rm-row${i === ui.subCursor ? " selected" : ""}`}
                      onClick={() => {
                        update((u) => ({ ...u, subCursor: i }));
                        inputRef.current.press("ok");
                      }}
                    >
                      <span>{label}</span>
                      <span>◀ {value} ▶</span>
                    </button>
                  ))}
                {ui.menuPage === "title" && (
                  <>
                    <div style={{ marginBottom: 8 }}>要回到標題畫面嗎？（進度已自動存檔）</div>
                    {["是", "否"].map((label, i) => (
                      <button
                        key={label}
                        className={`rm-item${i === ui.subCursor ? " selected" : ""}`}
                        onClick={() => {
                          update((u) => ({ ...u, subCursor: i }));
                          inputRef.current.press("ok");
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}

          {ui.mode === "ending" && ending && (
            <div className="rm-ending" data-testid="ending" data-ending-id={ending.id} onClick={() => update((u) => ({ ...u, mode: "title", titleCursor: 0 }))}>
              <h2>{ending.title}</h2>
              <p>{ending.text}</p>
              {endingEpilogues(project, game).map((line, i) => (
                <p key={i} className="rm-epilogue">
                  {line}
                </p>
              ))}
              <div className="rm-the-end">— THE END —</div>
              <div className="rm-dim">步數 {game.steps}・完成任務 {journal.filter((q) => q.status === "completed").length}</div>
              <div className="rm-hint">{layout.touch ? "點一下回到標題" : "按確定鍵回到標題"}</div>
            </div>
          )}

          {ui.notice && <div className="rm-window rm-notice">{ui.notice}</div>}
          {ui.savedFlash > 0 && ui.mode === "map" && (
            <div key={ui.savedFlash} className="rm-autosave" data-testid="autosave">
              💾 已自動存檔
            </div>
          )}
        </div>
      </div>
      {isStudio && (
        <button className="rm-debug-toggle" onClick={() => setDebugOpen((v) => !v)} data-testid="debug-toggle">
          🐞 F9 除錯
        </button>
      )}
      {isStudio && debugOpen && (
        <DebugPanel
          project={project}
          state={game}
          onChange={(next, label) => {
            update((u) => ({ ...u, game: reconcileState(project, next), mode: next.endingId ? "ending" : u.mode === "title" || u.mode === "cover" || u.mode === "splash" ? "map" : u.mode }));
            flash({ notice: label }, 1500, "notice");
          }}
          onStartChapter={(chapterId) => newGame(chapterId)}
          onClose={() => setDebugOpen(false)}
        />
      )}
      {layout.touch && ui.mode === "map" && !msg && ui.messages.length === 0 && (
        <button className="rm-menu-button" onClick={() => update((u) => ({ ...u, mode: "menu", menuPage: "root", menuCursor: 0, subCursor: 0 }))} aria-label="選單" data-testid="menu-button">
          ≡
        </button>
      )}
      {!layout.touch && (
        <button className="rm-fullscreen desktop" onClick={enterFullscreen} aria-label={isFullscreen ? "離開全螢幕" : "全螢幕"} title="全螢幕（F）">
          {isFullscreen ? "✕" : "⛶"}
        </button>
      )}
      {layout.touch && layout.canFullscreen && !layout.portrait && ui.mode !== "menu" && (
        <button className="rm-fullscreen" onClick={enterFullscreen} aria-label={isFullscreen ? "離開全螢幕" : "全螢幕"} data-testid="fullscreen">
          {isFullscreen ? "✕" : "⛶"}
        </button>
      )}
      {layout.touch && layout.portrait && !portraitOk && (
        <div className="rm-rotate" data-testid="rotate-hint">
          <div className="rm-rotate-icon">📱↻</div>
          <p>請將手機轉為橫向遊玩</p>
          {layout.canFullscreen && (
            <button className="rm-window rm-rotate-btn" onClick={enterFullscreen}>
              全螢幕並橫向
            </button>
          )}
          <button className="rm-window rm-rotate-btn" onClick={() => setPortraitOk(true)}>
            仍要直向遊玩
          </button>
        </div>
      )}
    </div>
  );
}

function SlotRow({
  project,
  slot,
  entry,
  selected,
  onSelect,
}: {
  project: GameProject;
  slot: SaveSlot;
  entry?: ReturnType<typeof listSaves>[number];
  selected: boolean;
  onSelect: (slot: SaveSlot) => void;
}) {
  const st = entry?.save?.state;
  const chapter = st ? project.chapters.find((c) => c.id === st.chapterId) : undefined;
  return (
    <button className={`rm-item rm-slot${selected ? " selected" : ""}`} onClick={() => onSelect(slot)} data-slot={slot}>
      <span className="rm-slot-name">{SAVE_LABEL[slot]}</span>
      {st ? (
        <span>
          {chapter ? `${chapter.title}・` : ""}
          {project.maps.find((m) => m.id === st.mapId)?.name ?? ""}
          {st.endingId ? "・已通關" : ""}
          <span className="rm-dim">　{formatTime(entry!.save!.savedAt)}</span>
        </span>
      ) : (
        <span className="rm-dim">{entry?.notice ?? "（空）"}</span>
      )}
    </button>
  );
}
