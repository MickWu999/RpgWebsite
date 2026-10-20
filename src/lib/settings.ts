/** 玩家偏好設定（存在此瀏覽器）：文字速度、背景音樂 */

export type TextSpeed = "slow" | "normal" | "fast";
/** 對話聲音：RPG 式嗶嗶聲、瀏覽器語音朗讀，或關閉 */
export type VoiceMode = "blip" | "tts" | "off";
export type Settings = { textSpeed: TextSpeed; bgm: boolean; voice: VoiceMode };

const KEY = "rpg:settings";
const DEFAULTS: Settings = { textSpeed: "normal", bgm: true, voice: "blip" };
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
