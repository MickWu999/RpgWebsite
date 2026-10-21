/** 玩家偏好設定（存在此瀏覽器）：文字速度、背景音樂、對話聲音、手機觸控方式 */

export type TextSpeed = "slow" | "normal" | "fast";
/** 對話聲音：RPG 式嗶嗶聲、瀏覽器語音朗讀，或關閉 */
export type VoiceMode = "blip" | "tts" | "off";
/** 手機觸控：pad＝十字鍵＋A 鍵；tap＝直接點擊（點地面走過去、點人物對話） */
export type TouchMode = "pad" | "tap";
/** 虛擬按鍵的透明度 */
export type PadOpacity = "low" | "mid" | "high";
export type Settings = { textSpeed: TextSpeed; bgm: boolean; voice: VoiceMode; touch: TouchMode; padOpacity: PadOpacity };

const KEY = "rpg:settings";
const DEFAULTS: Settings = { textSpeed: "normal", bgm: true, voice: "blip", touch: "pad", padOpacity: "mid" };
export const PAD_OPACITIES: PadOpacity[] = ["low", "mid", "high"];
export const PAD_OPACITY_LABEL: Record<PadOpacity, string> = { low: "淡", mid: "普通", high: "清楚" };
export const PAD_OPACITY_VALUE: Record<PadOpacity, number> = { low: 0.35, mid: 0.6, high: 0.9 };
export const TOUCH_MODES: TouchMode[] = ["pad", "tap"];
export const TOUCH_MODE_LABEL: Record<TouchMode, string> = { pad: "方向鍵＋A", tap: "直接點擊" };
export const VOICE_MODES: VoiceMode[] = ["blip", "tts", "off"];
export const VOICE_MODE_LABEL: Record<VoiceMode, string> = { blip: "嗶嗶聲", tts: "語音朗讀", off: "關閉" };
export const TEXT_SPEED_FACTOR: Record<TextSpeed, number> = { slow: 1.6, normal: 1, fast: 0.5 };
export const TEXT_SPEED_LABEL: Record<TextSpeed, string> = { slow: "慢", normal: "普通", fast: "快" };

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveSettings(settings: Settings) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // 無法記住偏好時不影響遊戲
  }
}
