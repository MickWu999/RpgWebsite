"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_MUSIC, MUSIC, SOUNDS, TERRAIN } from "@/game/assets";
import {
  availableChoices,
  choose,
  closeDialogue,
  createInitialState,
  currentDialogueNode,
  endingEpilogues,
  facedTile,
  interactableAt,
  getScene,
  interact,
  move,
  questTracker,
  XP_PER_LEVEL,
  type ActionResult,
  type Direction,
  type GameEvent,
  type PlayerState,
} from "@/game/engine";
import { findPath, pathToFace, pathToNpc } from "@/game/pathfinding";
import type { GameProject } from "@/game/schema";
import { coverDataOf } from "@/game/cover";
import { listSaves, loadProject, savePlayerState, type SaveSlot } from "@/game/storage";
import { estimateDuration } from "@/game/duration";
import { runPlaytest } from "@/game/playtest";
import { fetchPack } from "@/lib/packs";
import { getAudio } from "@/lib/audio";
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
import MessageWindow, { type TypingControl } from "./MessageWindow";
import TouchControls, { type InputKey } from "./TouchControls";

const GameCanvas = dynamic(() => import("../GameCanvas"), { ssr: false });

/**
 * RPG Maker 式的單一遊戲畫面：開發者 Logo → 封面（按任意鍵開始）→ 標題 → 地圖 →（選單）→ 結局 → 標題。
 * 遊戲來源可以是模組包（/games/<id>/project.json）或瀏覽器中的本機專案。
 * 所有 UI 都畫在 640×480 的邏輯畫面裡，整體等比縮放到視窗大小。
 * 確認：Z／Enter／空白鍵／E　取消／選單：X／Esc　移動：方向鍵／WASD
 * 手機：虛擬十字鍵＋A（確認）／B（取消／選單），與鍵盤共用同一套輸入邏輯。
 */

export const SCREEN_W = 640;
export const SCREEN_H = 480;
const MOVE_INTERVAL_MS = 140;
/** 手機橫向時畫面依螢幕比例變寬（固定寬 640，高度介於此範圍），搖桿與按鈕疊在畫面上 */
const MIN_SCREEN_H = 260;

type Mode = "loading" | "splash" | "cover" | "title" | "map" | "menu" | "ending";
export type GameSource = { kind: "pack" | "local"; id: string };
type MenuPage = "root" | "items" | "quests" | "status" | "save" | "load" | "options" | "title";
type Toast = { id: number; text: string };
type UI = {
  mode: Mode;
  game: PlayerState;
  titleCursor: number;
  titleLoad: boolean;
  slotCursor: number;
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

type Key = InputKey;
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
  const quest = (id: string) => project.quests.find((q) => q.id === id)?.title ?? id;
  switch (e.type) {
    case "item_gained":
      return `獲得了「${item(e.itemId)}」！`;
    case "item_removed":
      return `交出了「${item(e.itemId)}」`;
    case "quest_started":
      return `新任務：${quest(e.questId)}`;
    case "objective_completed":
      return `目標達成：${project.quests.find((q) => q.id === e.questId)?.objectives.find((o) => o.id === e.objectiveId)?.description ?? ""}`;
    case "quest_completed":
      return `任務完成：${quest(e.questId)}`;
    case "level_up":
      return `等級提升！Lv ${e.level}`;
    default:
      return null;
  }
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const sfx = (src: string, volume = 0.35) => getAudio().play(src, { volume });
const wrap = (n: number, len: number) => (len === 0 ? 0 : (n + len) % len);

export default function GameScreen({ source }: { source: GameSource }) {
  const projectId = source.id;
  const [project, setProject] = useState<GameProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 載入資訊：模組包下載大小、預估遊玩時長（顯示在 Logo 與封面上） */
  const [loadInfo, setLoadInfo] = useState<{ bytes?: number; minutes: [number, number] | null }>({ minutes: null });
  const [ui, setUi] = useState<UI | null>(null);
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

  const update = useCallback((next: UI | ((u: UI) => UI)) => {
    const current = uiRef.current;
    if (!current) return;
    const value = typeof next === "function" ? next(current) : next;
    uiRef.current = value;
    setUi(value);
  }, []);

  // ---------- 載入（模組包從伺服器下載並驗證；本機專案從 localStorage 讀取） ----------
  useEffect(() => {
    let cancelled = false;
    const start = (project: GameProject) => {
      if (cancelled) return;
      projectRef.current = project;
      const latest = listSaves(project)
        .filter((s) => s.save)
        .sort((a, b) => b.save!.savedAt.localeCompare(a.save!.savedAt))[0];
      const initial: UI = {
        mode: "splash",
        game: latest?.save?.state ?? createInitialState(project),
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
        notice: null,
        savedFlash: 0,
        settings: loadSettings(),
      };
      uiRef.current = initial;
      setProject(project);
      setUi(initial);
      // 開發者 Logo 顯示一下後自動進入封面
      window.setTimeout(() => {
        if (!cancelled && uiRef.current?.mode === "splash") {
          uiRef.current = { ...uiRef.current, mode: "cover" };
          setUi(uiRef.current);
        }
      }, 1600);
    };
    if (source.kind === "pack") {
      fetchPack(source.id)
        .then(({ project, bytes, entry }) => {
          if (cancelled) return;
          setLoadInfo({ bytes, minutes: entry?.typicalMinutes ?? null });
          start(project);
        })
        .catch((e: Error) => !cancelled && setLoadError(e.message));
    } else {
      const loaded = loadProject(source.id);
      Promise.resolve().then(() => {
        if (!loaded) return !cancelled && setLoadError(`找不到專案「${source.id}」。專案只存在建立它的瀏覽器中。`);
        // 本機專案沒有目錄資訊，用自動試玩即時估算時長
        setLoadInfo({ minutes: estimateDuration(loaded.project, runPlaytest(loaded.project, { maxStates: 1500 }))?.typicalMinutes ?? null });
        start(loaded.project);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [source.kind, source.id]);

  const cover = useMemo(() => (project ? coverDataOf(project) : null), [project]);

  // 網頁很容易被直接關掉：切到背景、關閉分頁時再強制存一次，並要求瀏覽器不要自動清除存檔
  useEffect(() => {
    const flush = () => {
      const u = uiRef.current;
      if (u && (u.mode === "map" || u.mode === "menu" || u.mode === "ending")) {
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
  }, []);

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
      const availableHeight = touch && portrait ? window.innerHeight - 210 : window.innerHeight;
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

  // ---------- 背景音樂：依模式與場景切換（標題用起始場景的曲子，結局時停止讓結局音樂播放） ----------
  const musicMode = ui?.mode;
  const musicScene = ui?.game.sceneId;
  const bgmOn = ui?.settings.bgm;
  useEffect(() => {
    const p = projectRef.current;
    if (!p || !musicMode || musicMode === "loading") return;
    if (!bgmOn || musicMode === "ending" || musicMode === "splash") {
      getAudio().playMusic(null);
      return;
    }
    const sceneId = musicMode === "title" || musicMode === "cover" ? (p.cover?.sceneId ?? p.startSceneId) : musicScene!;
    const mood = p.scenes.find((sc) => sc.id === sceneId)?.music ?? DEFAULT_MUSIC;
    getAudio().playMusic(MUSIC[mood].src);
  }, [musicMode, musicScene, bgmOn]);

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
      flash({ banner: { text: getScene(p, game.sceneId).name, id } });
    },
    [update, flash],
  );

  const act = useCallback(
    (fn: (p: GameProject, s: PlayerState) => ActionResult) => {
      const p = projectRef.current;
      const u = uiRef.current;
      if (!p || !u) return;
      const result = fn(p, u.game);
      if (result.state === u.game) return;
      const nodeChanged = result.state.dialogue?.nodeId !== u.game.dialogue?.nodeId || result.state.choicesMade.length !== u.game.choicesMade.length;
      const toasts = result.events.map((e) => eventToast(p, e)).filter((t): t is string => Boolean(t)).map((text) => ({ id: ++seq.current, text }));
      const sceneChanged = result.events.some((e) => e.type === "scene_changed");
      const important = result.events.some((e) => /^(item_|quest_|objective_|scene_changed|ending_|level_up)/.test(e.type));
      const fadeId = sceneChanged ? ++seq.current : u.fadeId;
      update({
        ...u,
        game: result.state,
        mode: result.state.endingId ? "ending" : u.mode,
        choiceCursor: nodeChanged ? 0 : u.choiceCursor,
        toasts: [...u.toasts, ...toasts].slice(-4),
        fadeId,
        savedFlash: important ? ++seq.current : u.savedFlash,
      });
      if (sceneChanged) flash({ banner: { text: getScene(p, result.state.sceneId).name, id: fadeId } });
      for (const t of toasts) window.setTimeout(() => update((x) => ({ ...x, toasts: x.toasts.filter((y) => y.id !== t.id) })), 2600);
      try {
        savePlayerState(result.state, "auto");
      } catch (e) {
        flash({ notice: (e as Error).message }, 4000, "notice");
      }
      getAudio().handleEvents(p, result.state, result.events);
    },
    [update, flash],
  );

  const newGame = useCallback(() => {
    const p = projectRef.current!;
    const fresh = createInitialState(p);
    savePlayerState(fresh, "auto");
    const intro = (p.intro ?? p.description).split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    enterMap(fresh, intro);
  }, [enterMap]);

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

  // ---------- 鍵盤與觸控輸入 ----------
  useEffect(() => {
    const held: Direction[] = [];
    let lastMove = 0;
    // 點擊移動：依尋路結果一步步走；走到 NPC 旁邊後自動對話。任何按鍵輸入都會取消
    let walkQueue: Direction[] = [];
    let talkAfterWalk = false;
    const canWalk = () => {
      const u = uiRef.current;
      return Boolean(u && u.mode === "map" && !u.game.dialogue && u.messages.length === 0 && !u.game.endingId);
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
          else router.push(source.kind === "local" ? "/create/" : "/");
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

      // 地圖：系統訊息 → 對話 → 自由行動
      if (u.messages.length > 0) {
        if (key === "ok") {
          if (typingRef.current.typing) typingRef.current.finish();
          else update({ ...u, messages: u.messages.slice(1), messageSeq: ++seq.current });
        }
        return;
      }
      if (u.game.dialogue) {
        const choices = availableChoices(p, u.game);
        if (key === "ok") {
          if (typingRef.current.typing) typingRef.current.finish();
          else if (choices.length > 0) {
            sfx(SOUNDS.select);
            act((pp, s) => choose(pp, s, choices[u.choiceCursor].id));
          } else act(closeDialogue);
        } else if ((key === "up" || key === "down") && choices.length > 0 && !typingRef.current.typing) {
          update({ ...u, choiceCursor: wrap(u.choiceCursor + (key === "up" ? -1 : 1), choices.length) });
        } else if (key.startsWith("digit") && !typingRef.current.typing) {
          const index = Number(key.slice(5)) - 1;
          if (choices[index]) {
            sfx(SOUNDS.select);
            act((pp, s) => choose(pp, s, choices[index].id));
          }
        }
        return;
      }
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
      const count = { items: Object.keys(u.game.inventory).length, quests: questTracker(p, u.game).length, status: 0, save: 3, load: 4, options: 4, title: 2 }[u.menuPage];
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

    /** 按確認鍵：與 NPC 或面前的調查點互動；什麼都沒有時，給面前地形的預設回應 */
    const examineFront = () => {
      const before = uiRef.current?.game;
      const p = projectRef.current;
      if (!before || !p) return;
      act(interact);
      if (uiRef.current?.game !== before) return;
      const { x, y } = facedTile(before);
      const row = getScene(p, before.sceneId).terrain?.[y];
      const text = row ? TERRAIN[[...row][x]]?.examine : undefined;
      if (text) update((u) => ({ ...u, messages: [text], messageSeq: ++seq.current }));
    };

    const tap = (x: number, y: number) => {
      const u = uiRef.current;
      const p = projectRef.current;
      if (!u || !p) return;
      getAudio().unlock();
      // 地圖以外的狀態（訊息、對話中），點擊畫面等同按確認鍵
      if (!canWalk()) {
        if (u.mode === "map") handle("ok");
        return;
      }
      // 點 NPC、調查點或不可行走的地形：走到正前方再調查；點地面：走過去
      const npc = p.npcs.find((n) => n.sceneId === u.game.sceneId && n.position.x === x && n.position.y === y);
      const scene = getScene(p, u.game.sceneId);
      const target = npc || interactableAt(p, u.game.sceneId, x, y) || (scene.walkable[y]?.[x] === false && scene.terrain);
      const path = npc
        ? pathToNpc(p, u.game, npc.id)
        : target
          ? pathToFace(p, u.game, u.game.sceneId, x, y)
          : findPath(p, u.game, (sid, px, py) => sid === u.game.sceneId && px === x && py === y);
      walkQueue = path ?? [];
      talkAfterWalk = Boolean(target && path);
    };

    const press = (key: Key, repeat = false) => {
      walkQueue = [];
      talkAfterWalk = false;
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
    const timer = window.setInterval(() => {
      if (walkQueue.length > 0 || talkAfterWalk) {
        if (!canWalk()) {
          walkQueue = [];
          talkAfterWalk = false;
        } else if (performance.now() - lastMove >= MOVE_INTERVAL_MS) {
          const next = walkQueue.shift();
          if (next) step(next);
          else {
            talkAfterWalk = false;
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
      window.clearInterval(timer);
    };
  }, [act, update, flash, newGame, enterMap, loadSlot, saveToSlot, router, source.kind]);

  /** Android 等支援的瀏覽器：進入全螢幕並鎖定橫向（iPhone Safari 不支援，按鈕不顯示） */
  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen();
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.("landscape");
    } catch {
      // 不支援鎖定方向時維持全螢幕即可
    }
  }, []);

  // ---------- 畫面 ----------
  if (loadError) {
    return (
      <div className="rm-stage">
        <div className="rm-error">
          <p>{loadError}</p>
          <Link href={source.kind === "local" ? "/create/" : "/"}>回到網站</Link>
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
  const node = ui.mode !== "title" ? currentDialogueNode(project, game) : null;
  const choices = node ? availableChoices(project, game) : [];
  const npc = game.dialogue ? project.npcs.find((n) => n.id === game.dialogue!.npcId) : undefined;
  const asset = (id?: string) => project.assetManifest.assets.find((a) => a.id === id);
  const speed = TEXT_SPEED_FACTOR[ui.settings.textSpeed];
  const ending = game.endingId ? project.endings.find((e) => e.id === game.endingId) : null;
  const saves = ui.mode === "title" || ui.menuPage === "save" || ui.menuPage === "load" ? listSaves(project) : [];
  const hasSave = saves.some((s) => s.save);
  const buttonLabels =
    ui.mode === "splash" || ui.mode === "cover"
      ? { a: "開始", b: "" }
      : ui.mode === "title"
      ? { a: "確定", b: ui.titleLoad ? "返回" : "" }
      : ui.mode === "menu"
        ? { a: "確定", b: "返回" }
        : ui.mode === "ending"
          ? { a: "標題", b: "" }
          : ui.messages.length > 0 || game.dialogue
            ? { a: choices.length > 0 ? "選擇" : "繼續", b: "" }
            : { a: "對話", b: "選單" };
  const clickChoice = (id: string) => {
    sfx(SOUNDS.select);
    act((p, s) => choose(p, s, id));
  };

  return (
    <div className={`rm-stage${layout.touch ? " touch" : ""}${layout.portrait ? " portrait" : ""}`} onPointerDown={() => getAudio().unlock()}>
      <div className="rm-screen-box" style={{ width: SCREEN_W * layout.scale, height: layout.height * layout.scale }}>
      <div
        className={`rm-screen${layout.height < 400 ? " short" : ""}`}
        style={{ width: SCREEN_W, height: layout.height, transform: `scale(${layout.scale})` }}
        data-testid="game-frame"
        data-mode={ui.mode}
      >
        <GameCanvas project={project} state={game} viewHeight={layout.height} onTileTap={(x, y) => inputRef.current.tap(x, y)} clientTapRef={clientTapRef} />

        {ui.mode !== "title" && <div key={ui.fadeId} className="rm-fade" />}

        {ui.banner && ui.mode === "map" && (
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
        {(ui.mode === "map" || ui.mode === "menu") && ui.messages.length === 0 && node && game.dialogue && (
          <MessageWindow
            key={`${game.dialogue.nodeId}:${game.choicesMade.length}`}
            speaker={node.speaker}
            text={node.text}
            voice={npc?.voice}
            portrait={asset(npc?.spriteAssetId)}
            portraitSize={layout.height < 400 ? 52 : 72}
            speedFactor={speed}
            voiceMode={ui.settings.voice}
            choices={choices}
            cursor={ui.choiceCursor}
            controlRef={typingRef}
            onChoose={clickChoice}
            onContinue={() => act(closeDialogue)}
          />
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
                      else router.push(source.kind === "local" ? "/create/" : "/");
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <div className="rm-hint">方向鍵選擇・Z／Enter 確認・X／Esc 取消</div>
          </div>
        )}

        {ui.mode === "menu" && (
          <div className="rm-menu" data-testid="menu">
            <div className="rm-window rm-menu-commands">
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
              {ui.menuPage === "root" && (
                <div className="rm-status-card">
                  <div className="rm-heading">{project.player.name}</div>
                  <div>Lv {game.stats.level}　HP {game.stats.hp}</div>
                  <div className="rm-bar">
                    <span style={{ width: `${((game.stats.xp % XP_PER_LEVEL) / XP_PER_LEVEL) * 100}%` }} />
                  </div>
                  <div className="rm-dim">經驗值 {game.stats.xp}・距離升級 {XP_PER_LEVEL - (game.stats.xp % XP_PER_LEVEL)}</div>
                  <div className="rm-dim" style={{ marginTop: 12 }}>
                    所在地：{getScene(project, game.sceneId).name}・步數 {game.steps}
                  </div>
                </div>
              )}
              {ui.menuPage === "items" &&
                (Object.keys(game.inventory).length === 0 ? (
                  <div className="rm-dim">沒有任何道具。</div>
                ) : (
                  Object.entries(game.inventory).map(([id, count], i) => {
                    const item = project.items.find((x) => x.id === id);
                    return (
                      <div key={id} className={`rm-item${i === ui.subCursor ? " selected" : ""}`}>
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
                (questTracker(project, game).length === 0 ? (
                  <div className="rm-dim">目前沒有任務。試著和附近的人說說話。</div>
                ) : (
                  questTracker(project, game).map((q) => (
                    <div key={q.id} className="rm-quest" data-testid="quest">
                      <div className="rm-row">
                        <span className="rm-heading">{q.title}</span>
                        <span className={q.status === "completed" ? "rm-ok" : "rm-warn"}>{q.status === "completed" ? "完成" : "進行中"}</span>
                      </div>
                      {q.objectives.map((o) => (
                        <div key={o.id} className={`rm-objective${o.done ? " done" : ""}${o.current ? " current" : ""}`}>
                          {o.description}
                        </div>
                      ))}
                    </div>
                  ))
                ))}
              {ui.menuPage === "status" && (
                <div className="rm-status-card">
                  <div className="rm-heading">{project.player.name}</div>
                  <p className="rm-dim">{project.player.description}</p>
                  <div>等級：{game.stats.level}</div>
                  <div>HP：{game.stats.hp}</div>
                  <div>經驗值：{game.stats.xp}</div>
                  <div>完成任務：{questTracker(project, game).filter((q) => q.status === "completed").length}</div>
                </div>
              )}
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
                  <div key={label} className={`rm-item rm-row${i === ui.subCursor ? " selected" : ""}`}>
                    <span>{label}</span>
                    <span>◀ {value} ▶</span>
                  </div>
                ))}
              {ui.menuPage === "title" && (
                <>
                  <div style={{ marginBottom: 8 }}>要回到標題畫面嗎？（進度已自動存檔）</div>
                  {["是", "否"].map((label, i) => (
                    <div key={label} className={`rm-item${i === ui.subCursor ? " selected" : ""}`}>
                      {label}
                    </div>
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
            <div className="rm-dim">Lv {game.stats.level}・經驗值 {game.stats.xp}・步數 {game.steps}</div>
            <div className="rm-hint">按確認鍵回到標題</div>
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
      {layout.touch && (
        <TouchControls
          joystick={ui.mode === "map" && !game.dialogue && ui.messages.length === 0}
          labels={buttonLabels}
          onPress={(k) => inputRef.current.press(k)}
          onRelease={(k) => inputRef.current.release(k)}
          onTapAt={(x, y) => clientTapRef.current?.(x, y)}
        />
      )}
      {layout.touch && layout.canFullscreen && !layout.portrait && (
        <button className="rm-fullscreen" onClick={enterFullscreen} aria-label="全螢幕">
          ⛶
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
  return (
    <button className={`rm-item rm-slot${selected ? " selected" : ""}`} onClick={() => onSelect(slot)} data-slot={slot}>
      <span className="rm-slot-name">{SAVE_LABEL[slot]}</span>
      {st ? (
        <span>
          {getScene(project, st.sceneId).name}・Lv {st.stats.level}
          {st.endingId ? "・已通關" : ""}
          <span className="rm-dim">　{formatTime(entry!.save!.savedAt)}</span>
        </span>
      ) : (
        <span className="rm-dim">{entry?.notice ?? "（空）"}</span>
      )}
    </button>
  );
}
