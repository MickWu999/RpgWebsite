"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import type { AssetDefinition, Voice } from "@/game/schema";
import { CHAR_INTERVAL_MS, getAudio } from "@/lib/audio";
import type { VoiceMode } from "@/lib/settings";
import Portrait from "./Portrait";

export type TypingControl = { typing: boolean; finish: () => void };

const SILENT = /[\s，。、！？；：「」『』（）…—,.!?;:()"'-]/;

/**
 * RPG Maker 式訊息視窗：畫面下方、名字框、頭像、逐字顯示並播放 NPC 合成講話聲。
 * 文字顯示完畢後才出現選項視窗（右側、可用方向鍵移動游標）。每則訊息以 key 重新掛載。
 */
export default function MessageWindow({
  speaker,
  text,
  voice,
  portrait,
  portraitSize = 72,
  speedFactor,
  voiceMode = "blip",
  choices,
  present = false,
  cursor,
  controlRef,
  onChoose,
  onContinue,
}: {
  speaker?: string;
  text: string;
  voice?: Voice;
  portrait?: AssetDefinition;
  portraitSize?: number;
  speedFactor: number;
  voiceMode?: VoiceMode;
  choices: Array<{ index: number; text: string }>;
  /** 出示物品：選項是道具欄裡的物品 */
  present?: boolean;
  cursor: number;
  controlRef: RefObject<TypingControl>;
  onChoose: (index: number) => void;
  onContinue: () => void;
}) {
  const chars = useMemo(() => [...text], [text]);
  const [shown, setShown] = useState(0);
  const typing = shown < chars.length;

  useEffect(() => {
    controlRef.current = { typing, finish: () => setShown(chars.length) };
  }, [controlRef, typing, chars.length]);

  useEffect(() => {
    if (!typing) return;
    const interval = CHAR_INTERVAL_MS[voice?.speed ?? "normal"] * speedFactor;
    const timer = window.setInterval(() => setShown((n) => Math.min(n + 1, chars.length)), interval);
    return () => window.clearInterval(timer);
  }, [typing, chars.length, voice?.speed, speedFactor]);

  // 嗶嗶聲：每個字一個音節（標點與空白不發聲）；系統訊息（沒有說話者）不發聲
  useEffect(() => {
    if (voiceMode !== "blip" || !speaker || shown === 0 || shown > chars.length || SILENT.test(chars[shown - 1])) return;
    getAudio().blip(voice);
  }, [shown, chars, voice, speaker, voiceMode]);

  // 語音朗讀：每則台詞出現時唸一次，換下一則或關閉時停止
  useEffect(() => {
    if (voiceMode !== "tts" || !speaker) return;
    getAudio().speak(text, voice);
    return () => getAudio().stopSpeaking();
  }, [voiceMode, speaker, text, voice]);

  return (
    <>
      {!typing && choices.length > 0 && (
        <div className={`rm-window rm-choices${present ? " present" : ""}`} role="listbox" aria-label={present ? "要拿出的物品" : "選項"} data-testid={present ? "present-items" : undefined}>
          {present && <div className="rm-choices-title">🎒 拿出……</div>}
          {choices.map((c, i) => (
            <button key={c.index} className={`rm-item${i === cursor ? " selected" : ""}`} data-choice-index={c.index} onClick={() => onChoose(c.index)}>
              {c.text}
            </button>
          ))}
        </div>
      )}
      <div className="rm-message" data-testid="dialogue" data-typing={typing}>
        {speaker && <div className="rm-window rm-namebox">{speaker}</div>}
        <div className="rm-window rm-message-body" onClick={() => (typing ? setShown(chars.length) : choices.length === 0 && onContinue())}>
          {portrait && <Portrait asset={portrait} size={portraitSize} />}
          <div className="rm-text">
            {chars.slice(0, shown).join("")}
            {!typing && choices.length === 0 && <span className="rm-pause">▼</span>}
          </div>
        </div>
      </div>
    </>
  );
}
