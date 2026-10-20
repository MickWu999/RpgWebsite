import { ENDING_JINGLES, FOOTSTEP_SURFACE, SOUNDS, type EndingMood } from "@/game/assets";
import { getScene, type GameEvent, type PlayerState } from "@/game/engine";
import type { GameProject, NPCDefinition } from "@/game/schema";

/**
 * 瀏覽器端音效（WebAudio）。
 * - 事件音效：由遊戲事件決定播放什麼，資料不需要指定。
 * - 講話聲：依 npc.voice（AI 設計）即時合成，不需要音檔。
 * - 背景音樂：循環播放，切換時淡入淡出；開關獨立於音效。
 * 瀏覽器規定使用者互動後才能播放聲音，所以第一次按鍵／點擊時才建立 AudioContext。
 * 載入或解碼失敗時靜默略過，不影響遊戲。
 */

const MUTE_KEY = "rpg:audio-muted";
type Voice = NonNullable<NPCDefinition["voice"]>;
const DEFAULT_VOICE: Voice = { pitch: "mid", speed: "normal", timbre: "soft" };
// 講話嗶嗶聲（RPG 常見做法）：音色依角色設定，音量要大到筆電喇叭也聽得到
const PITCH_HZ = { low: 180, mid: 320, high: 520 };
const WAVE = { soft: "triangle", bright: "square", buzzy: "sawtooth" } as const;
const BLIP_GAIN = { soft: 0.22, bright: 0.11, buzzy: 0.09 };
const MIN_BLIP_GAP = 0.045;
// 語音朗讀（Web Speech API）的音高與語速，對應 npc.voice
const TTS_PITCH = { low: 0.6, mid: 1, high: 1.45 };
const TTS_RATE = { slow: 0.85, normal: 1.05, fast: 1.25 };
export const CHAR_INTERVAL_MS = { slow: 55, normal: 35, fast: 22 };

class AudioManager {
  private ctx: AudioContext | null = null;
  private buffers = new Map<string, Promise<AudioBuffer | null>>();
  private stepIndex = 0;
  private music: { src: string; source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private wantedMusic: string | null = null;
  private lastBlip = 0;
  /** 已播放的講話音節數（供自動化驗證） */
  blipCount = 0;
  muted = false;

  constructor() {
    try {
      this.muted = typeof window !== "undefined" && window.localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      this.muted = false;
    }
  }

  /** 目前正在播放的背景音樂（供除錯與自動化驗證） */
  get currentMusic() {
    return this.music?.src ?? null;
  }

  /** 在使用者互動事件中呼叫，讓瀏覽器允許播放聲音 */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    // 第一次互動之前要求的背景音樂，在解鎖後開始播放
    if (this.wantedMusic && !this.music) this.playMusic(this.wantedMusic);
  }

  /** 播放循環背景音樂（同一首不重新開始）；null 表示停止。切換時淡入淡出。 */
  playMusic(src: string | null, volume = 0.3) {
    this.wantedMusic = src;
    if (!this.ctx || this.music?.src === src) return;
    const ctx = this.ctx;
    const old = this.music;
    if (old) {
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      old.source.stop(ctx.currentTime + 1.5);
      this.music = null;
    }
    if (!src) return;
    void this.load(src).then((buffer) => {
      if (!buffer || this.wantedMusic !== src || this.music) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.setTargetAtTime(volume, ctx.currentTime, 0.5);
      source.connect(gain).connect(ctx.destination);
      source.start();
      this.music = { src, source, gain };
    });
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // 無法記住偏好時不影響播放
    }
  }

  private load(src: string) {
    if (!this.ctx) return Promise.resolve(null);
    let p = this.buffers.get(src);
    if (!p) {
      const ctx = this.ctx;
      p = fetch(src)
        .then((r) => r.arrayBuffer())
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null);
      this.buffers.set(src, p);
    }
    return p;
  }

  play(src: string, { volume = 0.5, rate = 1 } = {}) {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    void this.load(src).then((buffer) => {
      if (!buffer || this.muted) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      gain.gain.value = volume;
      source.connect(gain).connect(ctx.destination);
      source.start();
    });
  }

  /** 合成一個講話音節（逐字顯示時每個字呼叫一次，間隔太短會略過） */
  blip(voice: Voice = DEFAULT_VOICE) {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastBlip < MIN_BLIP_GAP) return;
    this.lastBlip = now;
    this.blipCount++;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = WAVE[voice.timbre];
    osc.frequency.value = PITCH_HZ[voice.pitch] * (0.9 + Math.random() * 0.2);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(BLIP_GAIN[voice.timbre], now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.06);
  }

  /** 是否支援語音朗讀（瀏覽器內建語音合成，品質依裝置而定） */
  get canSpeak() {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  /** 用瀏覽器語音合成唸出台詞，音高與語速依 npc.voice（AI 設計） */
  speak(text: string, voice: Voice = DEFAULT_VOICE) {
    if (this.muted || !this.canSpeak) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-TW";
    const zh = synth.getVoices().find((v) => v.lang === "zh-TW") ?? synth.getVoices().find((v) => v.lang.startsWith("zh"));
    if (zh) utterance.voice = zh;
    utterance.pitch = TTS_PITCH[voice.pitch];
    utterance.rate = TTS_RATE[voice.speed];
    utterance.volume = 0.9;
    synth.speak(utterance);
  }

  stopSpeaking() {
    if (this.canSpeak) window.speechSynthesis.cancel();
  }

  /** 依遊戲事件播放對應音效 */
  handleEvents(project: GameProject, state: PlayerState, events: GameEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case "moved": {
          const scene = getScene(project, state.sceneId);
          const ch = scene.terrain ? [...scene.terrain[state.y]][state.x] : "=";
          const surface = FOOTSTEP_SURFACE[ch] ?? FOOTSTEP_SURFACE["="];
          this.stepIndex = (this.stepIndex + 1) % SOUNDS.footstep.length;
          this.play(SOUNDS.footstep[this.stepIndex], { volume: surface.volume, rate: surface.rate * (0.95 + Math.random() * 0.1) });
          break;
        }
        case "blocked":
          this.play(SOUNDS.bump, { volume: 0.2 });
          break;
        case "scene_changed":
          this.play(SOUNDS.door, { volume: 0.4 });
          break;
        case "item_gained":
          this.play(SOUNDS.pickup, { volume: 0.5 });
          break;
        case "quest_started":
          this.play(SOUNDS.questStart, { volume: 0.5 });
          break;
        case "objective_completed":
          this.play(SOUNDS.objective, { volume: 0.4 });
          break;
        case "quest_completed":
          this.play(SOUNDS.questComplete, { volume: 0.5 });
          break;
        case "level_up":
          this.play(SOUNDS.levelUp, { volume: 0.5 });
          break;
        case "dialogue_opened":
          this.play(SOUNDS.dialogueOpen, { volume: 0.35 });
          break;
        case "dialogue_closed":
          this.play(SOUNDS.dialogueClose, { volume: 0.3 });
          break;
        case "ending_reached": {
          const mood: EndingMood = project.endings.find((x) => x.id === e.endingId)?.mood ?? "triumphant";
          this.play(ENDING_JINGLES[mood], { volume: 0.6 });
          break;
        }
      }
    }
  }
}

let instance: AudioManager | null = null;
export function getAudio() {
  instance ??= new AudioManager();
  return instance;
}
